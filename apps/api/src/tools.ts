import { ToolError, ToolRegistry, type EmployeeRuntime } from "@wankong/agents";
import { findPolicies, redactPii, type Employee } from "@wankong/core";
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

  registry.register("task.progress", {
    definition: {
      name: "task.progress",
      description:
        "Report progress on one of your assigned tasks: update completion (0-1), or mark it done with a result. Identify the task by id or title.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task id (task_...)" },
          title: { type: "string", description: "Or: (part of) the task title" },
          progress: { type: "number", minimum: 0, maximum: 1 },
          done: { type: "boolean", description: "Mark the task complete" },
          result: { type: "string", description: "What was produced (required when done)" },
        },
      },
      triggers: [
        "\\b(finished|completed|done with)\\b[^.]*\\btask\\b",
        "\\bprogress\\b[^.]*\\btask\\b",
        "\\btask\\b[^.]*\\b(done|complete|progress)\\b",
      ],
    },
    requires: "task:create",
    async run(args, ctx) {
      const mine = await store.tasks.list(
        (t) =>
          t.organizationId === ctx.organizationId &&
          t.assignee?.kind === "employee" &&
          t.assignee.id === ctx.employeeId &&
          !["done", "cancelled"].includes(t.status),
      );
      const taskId = str(args.taskId);
      const title = str(args.title)?.toLowerCase();
      const task =
        (taskId && mine.find((t) => t.id === taskId)) ||
        (title && mine.find((t) => t.title.toLowerCase().includes(title))) ||
        (mine.length === 1 ? mine[0] : undefined);
      if (!task) {
        return mine.length === 0
          ? "You have no open assigned tasks."
          : `Which task? Your open tasks: ${mine.map((t) => `"${t.title}" (${t.id})`).join(", ")}.`;
      }

      const done = args.done === true;
      const progress =
        typeof args.progress === "number" ? Math.min(1, Math.max(0, args.progress)) : undefined;
      const updated = await store.tasks.update(task.id, {
        ...(done
          ? { status: "done" as const, progress: 1 }
          : {
              ...(progress !== undefined ? { progress } : {}),
              ...(task.status === "todo" ? { status: "in_progress" as const } : {}),
            }),
        ...(str(args.result) ? { result: str(args.result)!.slice(0, 20000) } : {}),
      });
      await store.audit({
        organizationId: ctx.organizationId,
        actor: { kind: "employee", id: ctx.employeeId },
        action: done ? "tool.task.complete" : "tool.task.progress",
        targetType: "task",
        targetId: task.id,
        metadata: { title: task.title, progress: updated.progress ?? null },
      });
      return done
        ? `Marked "${task.title}" done.`
        : `Updated "${task.title}" to ${Math.round((updated.progress ?? 0) * 100)}% complete.`;
    },
  });

  registry.register("studio.produce", {
    definition: {
      name: "studio.produce",
      description:
        "Produce a real company asset via a builtin studio (document/invoice, document/sop, design/business_card, legal/nda, financial/spend_report, cad/floor_plan, website/landing_page, conversion/*). Returns the stored asset id.",
      parameters: {
        type: "object",
        properties: {
          studioId: { type: "string" },
          kind: { type: "string" },
          title: { type: "string" },
          data: { type: "object" },
        },
        required: ["studioId", "kind"],
      },
      triggers: ["\\b(generate|create|produce|draft)\\b[^.]*\\b(invoice|sop|nda|report|card|banner|floor plan|landing page)\\b"],
    },
    requires: "task:create",
    async run(args, ctx) {
      const { generate: gen, StudioError } = await import("./studios/generate.js");
      try {
        const result = await gen(
          { store, organizationId: ctx.organizationId },
          str(args.studioId) ?? "document",
          {
            kind: str(args.kind) ?? "report",
            title: str(args.title) ?? undefined,
            data: (args.data ?? {}) as Record<string, unknown>,
          },
        );
        const asset = await store.assets.create({
          organizationId: ctx.organizationId,
          studioId: str(args.studioId) ?? "document",
          version: 1,
          createdBy: { kind: "employee", id: ctx.employeeId },
          ...result,
        });
        await store.audit({
          organizationId: ctx.organizationId,
          actor: { kind: "employee", id: ctx.employeeId },
          action: "studio.generate",
          targetType: "asset",
          targetId: asset.id,
          metadata: { studioId: asset.studioId, kind: asset.kind, title: asset.title },
        });
        return `Produced "${asset.title}" (${asset.id}, ${asset.mimeType}) in the ${asset.studioId} studio.`;
      } catch (e) {
        if (e instanceof StudioError) return e.message;
        throw e;
      }
    },
  });

  registry.register("policy.lookup", {
    definition: {
      name: "policy.lookup",
      description: "Look up company policies from the Company DNA (the central policy store).",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      triggers: ["\\b(policy|policies|allowed|permitted|company rule)\\b"],
    },
    requires: "org:read",
    async run(args, ctx) {
      const query = str(args.query) ?? "";
      const dna = (await store.companyDnas.listByOrg(ctx.organizationId))[0];
      if (!dna || dna.policies.length === 0) {
        return "No company policies are recorded in the Company DNA yet.";
      }
      const hits = findPolicies(dna, query);
      const chosen = hits.length > 0 ? hits : dna.policies;
      return chosen
        .slice(0, 3)
        .map((p) => `${p.name} v${p.version} (${p.kind}): ${p.rules.join(" · ")}`)
        .join(" | ");
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

  registry.register("collab.ask", {
    definition: {
      name: "collab.ask",
      description:
        "Consult a colleague AI employee (by name or title) and get their answer — lighter than delegate: a recorded conversation, no task. Pass conversationId to continue an existing consultation thread.",
      parameters: {
        type: "object",
        properties: {
          colleague: { type: "string", description: "The colleague's name or title" },
          question: { type: "string", description: "What to ask" },
          conversationId: { type: "string", description: "Continue this consultation thread" },
        },
        required: ["question"],
      },
      triggers: ["\\b(consult|get input from|what does)\\b[^.?!]*\\b(legal|finance|marketing|engineering|colleague|teammate)\\b"],
    },
    requires: "employee:chat",
    async run(args, ctx) {
      const question = str(args.question) ?? str(args.text) ?? "";
      const asker = await store.employees.get(ctx.employeeId);
      if (!asker) throw new ToolError("Asking employee not found");

      // Continue an existing thread, or resolve the colleague and open one.
      let conversation = null as Awaited<ReturnType<typeof store.conversations.get>>;
      let target: Employee | undefined;
      const existingId = str(args.conversationId);
      if (existingId) {
        conversation = await store.conversations.get(existingId);
        if (!conversation || conversation.organizationId !== ctx.organizationId) {
          throw new ToolError("Unknown consultation thread");
        }
        target = (await store.employees.get(conversation.employeeId)) ?? undefined;
      } else {
        const hint = (str(args.colleague) ?? question).toLowerCase();
        let bestLen = 0;
        for (const e of await store.employees.list(
          (e) => e.organizationId === ctx.organizationId && e.id !== ctx.employeeId,
        )) {
          for (const key of [e.name.toLowerCase(), e.title.toLowerCase()]) {
            if (hint.includes(key) && key.length > bestLen) {
              target = e;
              bestLen = key.length;
            }
          }
        }
      }
      if (!target) throw new ToolError("Name the colleague explicitly (e.g. \"the Legal Counsel\").");
      if (target.status !== "active") throw new ToolError(`${target.name} is ${target.status}.`);

      // History makes the thread multi-turn; the colleague answers with their
      // own grounding but WITHOUT tools — consultation is one hop deep.
      const history = conversation
        ? (await store.conversationMessages(conversation.id)).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        : [];
      const grounded = await buildGroundedEmployeeContext(store, ctx.organizationId, target, {
        query: question,
        embedder,
      });
      const startedAt = Date.now();
      const result = await runtime.complete({
        employee: target,
        context: grounded.context,
        history,
        input: question,
      });

      if (!conversation) {
        conversation = await store.conversations.create({
          organizationId: ctx.organizationId,
          employeeId: target.id,
          openedBy: { kind: "employee", id: asker.id },
          title: `Consultation: ${asker.name} ↔ ${target.name}`,
        });
      }
      await store.messages.create({
        conversationId: conversation.id, role: "user", authorId: asker.id, content: question,
      });
      await store.messages.create({
        conversationId: conversation.id, role: "assistant", authorId: target.id, content: result.text,
        tokensIn: result.usage.inputTokens, tokensOut: result.usage.outputTokens,
        provider: result.provider, model: result.model, latencyMs: Date.now() - startedAt,
      });
      await store.audit({
        organizationId: ctx.organizationId,
        actor: { kind: "employee", id: ctx.employeeId },
        action: "employee.collaborate",
        targetType: "conversation",
        targetId: conversation.id,
        metadata: { with: target.id, thread: conversation.title },
      });
      return `${target.name} says: ${result.text}\n\n(thread: ${conversation.id} — pass conversationId to continue)`;
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
