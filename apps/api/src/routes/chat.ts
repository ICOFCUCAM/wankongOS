import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { ChatMessage } from "@wankong/agents";
import type { Employee } from "@wankong/core";
import type { AppContext, Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";
import { buildGroundedEmployeeContext } from "../employee-context.js";
import { assertActive, assertWithinBudget } from "../governance.js";

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

  const result = await ctx.runtime.complete({
    employee,
    context: grounded.context,
    history,
    input,
    tools: toolsFor(ctx, employee),
  });

  await recordExchange(ctx, employee, conversation.id, input, result.text, result.usage);

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
    let text = "";
    const usage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of ctx.runtime.stream({
      employee,
      context: grounded.context,
      history,
      input,
      tools: toolsFor(ctx, employee),
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
    await recordExchange(ctx, employee, conversation.id, input, text, usage);
    await stream.writeSSE({
      event: "done",
      data: JSON.stringify({ usage, citations: grounded.citations }),
    });
  });
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

/** The employee's executable tools, bound to its own permissions. */
function toolsFor(ctx: AppContext, employee: Employee) {
  return {
    registry: ctx.toolRegistry,
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
) {
  await ctx.store.messages.create({
    conversationId,
    role: "user",
    content: input,
    tokensIn: usage.inputTokens,
  });
  await ctx.store.messages.create({
    conversationId,
    role: "assistant",
    authorId: employee.id,
    content: reply,
    tokensOut: usage.outputTokens,
  });
  // Capture a lightweight episodic memory of the request for future context.
  await ctx.store.memories.create({
    organizationId: ctx.organizationId,
    scope: "employee",
    kind: "event",
    ownerId: employee.id,
    content: `Handled a request: "${input.slice(0, 200)}"`,
    importance: 0.4,
    sourceConversationId: conversationId,
    lastAccessedAt: new Date().toISOString(),
  });
}
