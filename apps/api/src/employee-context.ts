import type { PromptContext } from "@wankong/agents";
import type { Employee } from "@wankong/core";
import type { MemoryStore } from "@wankong/store";

/**
 * Assemble the retrieval-grounded prompt context for an employee: its
 * organization, department, and manager, plus the most salient memories and a
 * few knowledge snippets from its knowledge bases. Shared by interactive chat
 * and the workflow engine so an employee behaves identically in both.
 */
export async function buildEmployeePromptContext(
  store: MemoryStore,
  organizationId: string,
  employee: Employee,
): Promise<PromptContext> {
  const [org, department, manager] = await Promise.all([
    store.organizations.get(organizationId),
    store.departments.get(employee.departmentId),
    employee.managerId ? store.employees.get(employee.managerId) : Promise.resolve(null),
  ]);

  const memories = (
    await store.memories.list(
      (m) =>
        m.organizationId === organizationId &&
        (m.scope === "organization" || m.ownerId === employee.id),
    )
  )
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5)
    .map((m) => m.content);

  const docs = await store.documents.list((d) =>
    employee.knowledgeBaseIds.includes(d.knowledgeBaseId),
  );
  const knowledge = docs
    .slice(0, 3)
    .map((d) => ({ title: d.title, text: d.content.slice(0, 500) }));

  return {
    organizationName: org?.name ?? "the company",
    departmentName: department?.name,
    managerName: manager?.name,
    memories,
    knowledge,
    toolNames: employee.toolIds,
  };
}
