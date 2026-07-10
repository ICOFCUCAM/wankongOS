import { ToolError, ToolRegistry, type EmployeeRuntime } from "@wankong/agents";
import { redactPii, type Employee } from "@wankong/core";
import type { Embedder } from "@wankong/knowledge";
import type { Store } from "@wankong/store";
import { searchKnowledge } from "./retrieval.js";
import { buildGroundedEmployeeContext } from "./employee-context.js";

/**
 * The built-in tool registry: capabilities employees can genuinely execute,
 * each gated on a permission the employee must hold. The hermetic local
 * provider decides to call them via each definition's `triggers`; cloud models
 * decide natively from name/description/schema.
 *
 * Local-provider convention: arguments arrive as `{ text: <user request> }`;
 * each tool maps that onto its primary field when structured fields are absent.
 */
export function buildToolRegistry(
  store: Store,
  organizationId: string,
  embedder: Embedder,
  runtime: EmployeeRuntime,
): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register("task.create", {
    definition: {
      name: "task.create",
      description: "Create a task in the organization's task board.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short task title" },
          description: { type: "string" },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        },
        required: ["title"],
      },
      triggers: ["\\b(create|add|open|log)\\b[^.]*\\btask\\b", "\\btask\\b[^.]*\\b(create|add|for)\\b"],
    },
    requires: "task:create",
    async run(args, ctx) {
      const title = str(args.title) ?? str(args.text) ?? "Untitled task";
      const task = await store.tasks.create({
        organizationId: ctx.organizationId,
        title: title.slice(0, 200),
        description: str(args.description) ?? "",
        status: "todo",
        priority: (str(args.priority) as "low" | "normal" | "high" | "urgent") ?? "normal",
        createdBy: { kind: "employee", id: ctx.employeeId },
        labels: ["via-tool"],
      });
      await store.audit({
        organizationId: ctx.organizationId,
        actor: { kind: "employee", id: ctx.employeeId },
        action: "tool.task.create",
        targetType: "task",
        targetId: task.id,
        metadata: { title: task.title },
      });
      return `Created task "${task.title}" (${task.id}) with priority ${task.priority}.`;
    },
  });

  registry.register("kb.search", {
    definition: {
      name: "kb.search",
      description: "Search the company knowledge base and return cited passages.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      triggers: ["\\b(search|look up|check)\\b[^.]*\\b(knowledge|policy|handbook|playbook|docs)\\b"],
    },
    requires: "knowledge:read",
    async run(args, ctx) {
      const query = str(args.query) ?? str(args.text) ?? "";
      const citations = await searchKnowledge(store, ctx.organizationId, embedder, query, {
        limit: 3,
      });
      if (citations.length === 0) return `No knowledge found for "${query}".`;
      return citations
        .map((c) => `[${c.title}] ${c.snippet.replace(/\s+/g, " ").slice(0, 160)}`)
        .join(" | ");
    },
  });

  registry.register("memory.save", {
    definition: {
      name: "memory.save",
      description: "Save an important fact or decision to the employee's long-term memory.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string" },
          importance: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["content"],
      },
      triggers: ["\\b(remember|note down|don'?t forget|make a note)\\b"],
    },
    async run(args, ctx) {
      // Memories never store PII verbatim (§3.4).
      const content = redactPii(
        (str(args.content) ?? str(args.text) ?? "").slice(0, 4000),
      ).text;
      const memory = await store.memories.create({
        organizationId: ctx.organizationId,
        scope: "employee",
        kind: "fact",
        ownerId: ctx.employeeId,
        content,
        importance: typeof args.importance === "number" ? args.importance : 0.7,
        lastAccessedAt: new Date().toISOString(),
      });
      return `Saved to memory (${memory.id}): "${content.slice(0, 120)}".`;
    },
  });

  registry.register("delegate", {
    definition: {
      name: "delegate",
      description:
        "Delegate a request to a colleague AI employee (by name or title) and return their answer. Every delegation is recorded as a task and audited.",
      parameters: {
        type: "object",
        properties: {
          colleague: { type: "string", description: "The colleague's name or title" },
          request: { type: "string", description: "What to ask the colleague to do" },
        },
        required: ["colleague", "request"],
      },
      triggers: [
        "\\b(ask|delegate to|check with|hand (this |it )?to)\\b[^.?!]*\\b(analyst|assistant|director|manager|officer|recruiter|accountant|counsel|legal|research)\\b",
      ],
    },
    requires: "task:assign",
    async run(args, ctx) {
      const request = str(args.request) ?? str(args.text) ?? "";
      const hint = (str(args.colleague) ?? request).toLowerCase();

      const [delegator, colleagues] = await Promise.all([
        store.employees.get(ctx.employeeId),
        store.employees.list(
          (e) => e.organizationId === ctx.organizationId && e.id !== ctx.employeeId,
        ),
      ]);
      if (!delegator) throw new ToolError("Delegating employee not found");

      // Resolve the colleague: longest name/title appearing in the hint wins.
      let target: Employee | undefined;
      let bestLen = 0;
      for (const e of colleagues) {
        for (const key of [e.name.toLowerCase(), e.title.toLowerCase()]) {
          if (hint.includes(key) && key.length > bestLen) {
            target = e;
            bestLen = key.length;
          }
        }
      }
      if (!target) {
        throw new ToolError(
          "Could not identify which colleague to delegate to — name them explicitly (e.g. \"the Research Analyst\").",
        );
      }
      if (target.status !== "active") {
        throw new ToolError(`${target.name} is ${target.status} and cannot take on work.`);
      }

      // The colleague answers with their OWN grounding but WITHOUT tools —
      // delegation is one hop deep by construction, never a recursion chain.
      const grounded = await buildGroundedEmployeeContext(store, ctx.organizationId, target, {
        query: request,
        embedder,
      });
      const startedAt = Date.now();
      const result = await runtime.complete({
        employee: target,
        context: grounded.context,
        input: request,
      });

      // Traceability: the exchange is a real conversation between employees…
      const conversation = await store.conversations.create({
        organizationId: ctx.organizationId,
        employeeId: target.id,
        openedBy: { kind: "employee", id: delegator.id },
        title: `Delegation: ${delegator.name} → ${target.name}`,
      });
      await store.messages.create({
        conversationId: conversation.id,
        role: "user",
        authorId: delegator.id,
        content: request,
      });
      await store.messages.create({
        conversationId: conversation.id,
        role: "assistant",
        authorId: target.id,
        content: result.text,
        tokensIn: result.usage.inputTokens,
        tokensOut: result.usage.outputTokens,
        provider: result.provider,
        model: result.model,
        latencyMs: Date.now() - startedAt,
      });
      // …a completed task on the board…
      const task = await store.tasks.create({
        organizationId: ctx.organizationId,
        title: `Delegated to ${target.name}: ${request.slice(0, 140)}`,
        description: "",
        status: "done",
        priority: "normal",
        assignee: { kind: "employee", id: target.id },
        createdBy: { kind: "employee", id: delegator.id },
        labels: ["delegation"],
        result: result.text.slice(0, 20000),
      });
      // …and an audit entry.
      await store.audit({
        organizationId: ctx.organizationId,
        actor: { kind: "employee", id: delegator.id },
        action: "employee.delegate",
        targetType: "employee",
        targetId: target.id,
        metadata: { taskId: task.id, conversationId: conversation.id },
      });

      const reply = result.text.length > 1500 ? `${result.text.slice(0, 1497)}…` : result.text;
      return `${target.name} (${target.title}) responded: ${reply}`;
    },
  });

  return registry;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
