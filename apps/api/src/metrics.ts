import { estimateCostUsd, type Message, type ProviderId } from "@wankong/core";
import type { Store } from "@wankong/store";

export interface UsageBucket {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  estCostUsd: number;
  latencies: number[];
}

/** Per-employee usage aggregated from recorded assistant messages. */
export async function perEmployeeUsage(
  store: Store,
  organizationId: string,
): Promise<Map<string, UsageBucket>> {
  const [conversations, messages] = await Promise.all([
    store.conversations.list((cv) => cv.organizationId === organizationId),
    store.messages.list(),
  ]);
  const employeeByConversation = new Map(conversations.map((cv) => [cv.id, cv.employeeId]));
  const buckets = new Map<string, UsageBucket>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const employeeId = employeeByConversation.get(message.conversationId);
    if (!employeeId) continue;
    let b = buckets.get(employeeId);
    if (!b) {
      b = { requests: 0, tokensIn: 0, tokensOut: 0, estCostUsd: 0, latencies: [] };
      buckets.set(employeeId, b);
    }
    b.requests += 1;
    b.tokensIn += message.tokensIn ?? 0;
    b.tokensOut += message.tokensOut ?? 0;
    if (typeof message.latencyMs === "number") b.latencies.push(message.latencyMs);
    b.estCostUsd += costOf(message);
  }
  return buckets;
}

export function avgOf(samples: number[]): number | null {
  if (samples.length === 0) return null;
  return Math.round(samples.reduce((n, s) => n + s, 0) / samples.length);
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function costOf(message: Message): number {
  const provider = (message.provider ?? "local") as ProviderId;
  return estimateCostUsd(provider, message.model, message.tokensIn ?? 0, message.tokensOut ?? 0);
}
