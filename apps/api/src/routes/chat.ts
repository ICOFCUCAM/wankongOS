import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { ChatMessage } from "@wankong/agents";
import { redactPii, type Employee, type ProviderId } from "@wankong/core";
import type { AppContext, Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";
import { buildGroundedEmployeeContext } from "../employee-context.js";
import { assertActive, assertWithinBudget } from "../governance.js";
import { composeToolRegistry } from "../mcp-tools.js";

const ChatInput = z.object({
  input: z.string().min(1).max(20000),
  conversationId: z.string().optional(),
});

export const chatRoutes = new Hono<Env>();

/** Buffered chat: run the employee to completion and return the full reply. */
chatRoutes.post("/employees/:id/chat", async (c) => {
  authorize(c, "employee:chat");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const { input, conversationId } = await parseBody(c, ChatInput);
  assertActive(employee);
  await assertWithinBudget(ctx.store, employee);

  const conversation = await ensureConversation(ctx, employee, conversationId, c.get("actor").user.id);
  const history = await loadHistory(ctx, conversation.id);
  const grounded = await buildGroundedEmployeeContext(ctx.store, ctx.organizationId, employee, {
    query: input,
    embedder: ctx.embedder,
  });

  const startedAt = Date.now();
  const result = await ctx.runtime.complete({
    employee,
    context: grounded.context,
    history,
    input,
    tools: await toolsFor(ctx, employee),
  });

  await recordExchange(ctx, employee, conversation.id, input, result.text, result.usage, {
    provider: result.provider,
    model: result.model,
    latencyMs: Date.now() - startedAt,
  });

  return c.json({
    conversationId: conversation.id,
    reply: result.text,
    citations: grounded.citations,
    tools: result.executedTools,
    usage: result.usage,
    provider: result.provider,
    model: result.model,
  });
});

/** Streaming chat over Server-Sent Events. */
chatRoutes.post("/employees/:id/chat/stream", async (c) => {
  authorize(c, "employee:chat");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const { input, conversationId } = await parseBody(c, ChatInput);
  assertActive(employee);
  await assertWithinBudget(ctx.store, employee);

  const conversation = await ensureConversation(ctx, employee, conversationId, c.get("actor").user.id);
  const history = await loadHistory(ctx, conversation.id);
  const grounded = await buildGroundedEmployeeContext(ctx.store, ctx.organizationId, employee, {
    query: input,
    embedder: ctx.embedder,
  });

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "start", data: JSON.stringify({ conversationId: conversation.id }) });
    const startedAt = Date.now();
    let text = "";
    const usage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of ctx.runtime.stream({
      employee,
      context: grounded.context,
      history,
      input,
      tools: await toolsFor(ctx, employee),
    })) {
      if (chunk.type === "text") {
        text += chunk.delta;
        await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: chunk.delta }) });
      } else if (chunk.type === "tool_result") {
        await stream.writeSSE({ event: "tool", data: JSON.stringify(chunk.tool) });
      } else if (chunk.type === "done") {
        usage.inputTokens += chunk.usage.inputTokens;
        usage.outputTokens += chunk.usage.outputTokens;
      }
    }
    await recordExchange(ctx, employee, conversation.id, input, text, usage, {
      provider: ctx.registry.get(employee.provider).id,
      model: employee.model ?? ctx.registry.get(employee.provider).defaultModel,
      latencyMs: Date.now() - startedAt,
    });
    await stream.writeSSE({
      event: "done",
      data: JSON.stringify({ usage, citations: grounded.citations }),
    });
  });
});

/** An employee's conversations, newest first (Level 8: chats are records too). */
chatRoutes.get("/employees/:id/conversations", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const employee = await findScoped(c, (id) => ctx.store.employees.get(id), c.req.param("id"));
  const conversations = await ctx.store.conversations.list(
    (cv) => cv.organizationId === ctx.organizationId && cv.employeeId === employee.id,
  );
  conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const data = await Promise.all(
    conversations.slice(0, 20).map(async (cv) => {
      const messages = await ctx.store.conversationMessages(cv.id);
      const last = messages[messages.length - 1];
      return {
        id: cv.id,
        title: cv.title,
        updatedAt: cv.updatedAt,
        messageCount: messages.length,
        lastMessage: last ? last.content.slice(0, 140) : null,
      };
    }),
  );
  return c.json({ data });
});

/** Messages in a conversation. */
chatRoutes.get("/conversations/:id", async (c) => {
  authorize(c, "employee:read");
  const ctx = c.get("ctx");
  const conversation = await findScoped(
    c,
    (id) => ctx.store.conversations.get(id),
    c.req.param("id"),
  );
  const messages = await ctx.store.conversationMessages(conversation.id);
  return c.json({ conversation, messages });
});

// --- helpers ---------------------------------------------------------------

async function ensureConversation(
  ctx: AppContext,
  employee: Employee,
  conversationId: string | undefined,
  userId: string,
) {
  if (conversationId) {
    const existing = await ctx.store.conversations.get(conversationId);
    if (existing && existing.organizationId === ctx.organizationId) return existing;
  }
  return ctx.store.conversations.create({
    organizationId: ctx.organizationId,
    employeeId: employee.id,
    openedBy: { kind: "user", id: userId },
    title: `Chat with ${employee.name}`,
  });
}

async function loadHistory(ctx: AppContext, conversationId: string): Promise<ChatMessage[]> {
  const messages = await ctx.store.conversationMessages(conversationId);
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

/** The employee's executable tools (built-ins + connected MCP servers). */
async function toolsFor(ctx: AppContext, employee: Employee) {
  return {
    registry: await composeToolRegistry(ctx.toolRegistry, ctx.store, ctx.organizationId),
    context: {
      organizationId: ctx.organizationId,
      employeeId: employee.id,
      permissions: employee.permissions,
    },
  };
}

async function recordExchange(
  ctx: AppContext,
  employee: Employee,
  conversationId: string,
  input: string,
  reply: string,
  usage: { inputTokens: number; outputTokens: number },
  observed?: { provider: ProviderId; model: string; latencyMs: number },
) {
  await ctx.store.messages.create({
    conversationId,
    role: "user",
    content: input,
  });
  // The assistant turn is the single accounting record for the exchange:
  // both token counts live here, alongside provider/model/latency, so cost
  // attribution prices input and output at the correct model's rates.
  await ctx.store.messages.create({
    conversationId,
    role: "assistant",
    authorId: employee.id,
    content: reply,
    tokensIn: usage.inputTokens,
    tokensOut: usage.outputTokens,
    provider: observed?.provider,
    model: observed?.model,
    latencyMs: observed?.latencyMs,
  });
  // Capture a lightweight episodic memory of the request for future context.
  // PII is redacted at this boundary (§3.4) — memories must never hoard
  // customer emails, card numbers, or phone numbers verbatim.
  const redacted = redactPii(input.slice(0, 200));
  await ctx.store.memories.create({
    organizationId: ctx.organizationId,
    scope: "employee",
    kind: "event",
    ownerId: employee.id,
    content: `Handled a request: "${redacted.text}"`,
    importance: 0.4,
    sourceConversationId: conversationId,
    lastAccessedAt: new Date().toISOString(),
  });
}
