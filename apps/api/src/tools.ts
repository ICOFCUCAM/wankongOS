import { ToolRegistry } from "@wankong/agents";
import { redactPii } from "@wankong/core";
import type { Embedder } from "@wankong/knowledge";
import type { Store } from "@wankong/store";
import { searchKnowledge } from "./retrieval.js";

/**
 * The built-in tool registry: capabilities employees can genuinely execute,
 * each gated on a permission the employee must hold. The hermetic local
 * provider decides to call them via each definition's `triggers`; cloud models
 * decide natively from name/description/schema.
 *
 * Local-provider convention: arguments arrive as `{ text: <user request> }`;
 * each tool maps that onto its primary field when structured fields are absent.
 */
export function buildToolRegistry(store: Store, organizationId: string, embedder: Embedder): ToolRegistry {
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

  return registry;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
