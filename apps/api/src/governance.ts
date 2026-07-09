import { HTTPException } from "hono/http-exception";
import type { Employee } from "@wankong/core";
import type { MemoryStore } from "@wankong/store";

/** Tokens (input + output) consumed today across an employee's conversations. */
export async function todaysTokenUsage(
  store: MemoryStore,
  employeeId: string,
  now: Date = new Date(),
): Promise<number> {
  const conversations = await store.conversations.list((c) => c.employeeId === employeeId);
  if (conversations.length === 0) return 0;
  const ids = new Set(conversations.map((c) => c.id));
  const today = now.toISOString().slice(0, 10);
  const messages = await store.messages.list(
    (m) => ids.has(m.conversationId) && m.createdAt.startsWith(today),
  );
  return messages.reduce((n, m) => n + (m.tokensIn ?? 0) + (m.tokensOut ?? 0), 0);
}

/**
 * Enforce the employee's daily token budget. A hard ceiling, not advisory:
 * once today's usage reaches the cap, new work is refused with 429 until the
 * day rolls over or the budget is raised.
 */
export async function assertWithinBudget(store: MemoryStore, employee: Employee): Promise<void> {
  if (!employee.dailyTokenBudget) return;
  const used = await todaysTokenUsage(store, employee.id);
  if (used >= employee.dailyTokenBudget) {
    throw new HTTPException(429, {
      message: `Daily token budget exhausted (${used}/${employee.dailyTokenBudget}). Raise the budget or try again tomorrow.`,
    });
  }
}

/** Only active employees take on work. Training/paused/offboarded refuse with 409. */
export function assertActive(employee: Employee): void {
  if (employee.status !== "active") {
    throw new HTTPException(409, {
      message: `${employee.name} is ${employee.status} and cannot take on work${
        employee.status === "training" ? " until activated (pass evals to graduate probation)" : ""
      }.`,
    });
  }
}
