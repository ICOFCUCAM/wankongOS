import type { PromptContext } from "@wankong/agents";
import { rankMemories, type Employee } from "@wankong/core";
import type { Citation, Embedder } from "@wankong/knowledge";
import type { Store } from "@wankong/store";
import { searchKnowledge } from "./retrieval.js";

export interface GroundedContext {
  context: PromptContext;
  /** Retrieval hits backing the knowledge in the context; cite these in replies. */
  citations: Citation[];
}

export interface GroundingOptions {
  /** When set, knowledge is retrieved semantically for this query. */
  query?: string;
  embedder?: Embedder;
}

/**
 * Assemble the retrieval-grounded prompt context for an employee: its
 * organization, department, and manager, the highest-scoring memories
 * (importance × recency), and knowledge selected for the current query via
 * embedding search over the employee's knowledge bases. Without a query (e.g.
 * workflow steps resolved before their prompt is rendered), a short preview of
 * each knowledge base is used instead. Shared by interactive chat and the
 * workflow engine so an employee behaves identically in both.
 */
export async function buildGroundedEmployeeContext(
  store: Store,
  organizationId: string,
  employee: Employee,
  options: GroundingOptions = {},
): Promise<GroundedContext> {
  const [org, department, manager, brandKits] = await Promise.all([
    store.organizations.get(organizationId),
    store.departments.get(employee.departmentId),
    employee.managerId ? store.employees.get(employee.managerId) : Promise.resolve(null),
    store.brandKits.list((b) => b.organizationId === organizationId),
  ]);

  const memories = rankMemories(
    await store.memories.list(
      (m) =>
        m.organizationId === organizationId &&
        (m.scope === "organization" || m.ownerId === employee.id),
    ),
  )
    .slice(0, 5)
    .map((m) => m.content);

  let citations: Citation[] = [];
  let knowledge: { title: string; text: string }[];

  if (options.query && options.embedder && employee.knowledgeBaseIds.length > 0) {
    citations = await searchKnowledge(store, organizationId, options.embedder, options.query, {
      knowledgeBaseIds: employee.knowledgeBaseIds,
      limit: 4,
    });
    knowledge = citations.map((c) => ({ title: c.title, text: c.snippet }));
  } else {
    const docs = await store.documents.list((d) =>
      employee.knowledgeBaseIds.includes(d.knowledgeBaseId),
    );
    knowledge = docs.slice(0, 3).map((d) => ({ title: d.title, text: d.content.slice(0, 500) }));
  }

  return {
    citations,
    context: {
      organizationName: org?.name ?? "the company",
      departmentName: department?.name,
      managerName: manager?.name,
      memories,
      knowledge,
      toolNames: employee.toolIds,
      brandVoice: brandKits[0]?.toneOfVoice,
    },
  };
}

/** Context without query grounding (used where no user input exists yet). */
export async function buildEmployeePromptContext(
  store: Store,
  organizationId: string,
  employee: Employee,
): Promise<PromptContext> {
  return (await buildGroundedEmployeeContext(store, organizationId, employee)).context;
}
