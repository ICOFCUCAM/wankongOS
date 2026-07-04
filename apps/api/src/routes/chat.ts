import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { ChatMessage } from "@wankong/agents";
import type { Employee } from "@wankong/core";
import type { AppContext, Env } from "../context.js";
import { authorize, findScoped, parseBody } from "../http.js";

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

  const conversation = await ensureConversation(ctx, employee, conversationId, c.get("actor").user.id);
  const history = await loadHistory(ctx, conversation.id);
  const promptContext = await buildPromptContext(ctx, employee);

  const result = await ctx.runtime.complete({ employee, context: promptContext, history, input });

  await recordExchange(ctx, employee, conversation.id, input, result.text, result.usage);

  return c.json({
    conversationId: conversation.id,
    reply: result.text,
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

  const conversation = await ensureConversation(ctx, employee, conversationId, c.get("actor").user.id);
  const history = await loadHistory(ctx, conversation.id);
  const promptContext = await buildPromptContext(ctx, employee);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "start", data: JSON.stringify({ conversationId: conversation.id }) });
    let text = "";
    let usage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of ctx.runtime.stream({ employee, context: promptContext, history, input })) {
      if (chunk.type === "text") {
        text += chunk.delta;
        await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: chunk.delta }) });
      } else if (chunk.type === "done") {
        usage = chunk.usage;
      }
    }
    await recordExchange(ctx, employee, conversation.id, input, text, usage);
    await stream.writeSSE({ event: "done", data: JSON.stringify({ usage }) });
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

async function buildPromptContext(ctx: AppContext, employee: Employee) {
  const [org, department, manager] = await Promise.all([
    ctx.store.organizations.get(ctx.organizationId),
    ctx.store.departments.get(employee.departmentId),
    employee.managerId ? ctx.store.employees.get(employee.managerId) : Promise.resolve(null),
  ]);

  // Retrieve the most salient employee/org memories (real retrieval, no stub).
  const memories = (
    await ctx.store.memories.list(
      (m) =>
        m.organizationId === ctx.organizationId &&
        (m.scope === "organization" || m.ownerId === employee.id),
    )
  )
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5)
    .map((m) => m.content);

  // Pull a few knowledge chunks from the employee's knowledge bases.
  const docs = await ctx.store.documents.list(
    (d) => employee.knowledgeBaseIds.includes(d.knowledgeBaseId),
  );
  const knowledge = docs.slice(0, 3).map((d) => ({ title: d.title, text: d.content.slice(0, 500) }));

  return {
    organizationName: org?.name ?? "the company",
    departmentName: department?.name,
    managerName: manager?.name,
    memories,
    knowledge,
    toolNames: employee.toolIds,
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
