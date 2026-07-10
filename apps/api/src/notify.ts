import type { Store } from "@wankong/store";

/**
 * The notification spine: every decision-needing event lands in the inbox
 * of users who can act on it (org owners/admins), and fans out to the
 * webhook event bus. Email/Slack/push are delivery channels that attach at
 * this seam via connectors — the inbox is the always-on floor.
 */
export async function notify(
  store: Store,
  organizationId: string,
  input: { kind: string; title: string; body?: string; link?: string },
): Promise<number> {
  // Channel fan-out: a connected Slack integration mirrors the inbox entry.
  void deliverSlack(store, organizationId, `*${input.title}*${input.body ? `\n${input.body}` : ""}`);
  const recipients = await store.users.list(
    (u) => u.organizationId === organizationId && u.status === "active" && (u.role === "owner" || u.role === "admin"),
  );
  for (const user of recipients) {
    await store.notifications.create({
      organizationId,
      userId: user.id,
      kind: input.kind,
      title: input.title,
      body: input.body ?? "",
      link: input.link,
      read: false,
    });
  }
  return recipients.length;
}

/**
 * Slack channel delivery via a connected integration's incoming-webhook URL.
 * Failures are swallowed (the in-app inbox is the reliable floor) but
 * reported in the return for callers that care.
 */
export async function deliverSlack(
  store: Store,
  organizationId: string,
  text: string,
): Promise<{ delivered: boolean; reason?: string }> {
  const integration = (
    await store.integrations.list(
      (i) => i.organizationId === organizationId && i.kind === "slack" && i.status === "connected",
    )
  )[0];
  const url = (integration?.config as { webhookUrl?: string } | undefined)?.webhookUrl;
  if (!url) return { delivered: false, reason: "no connected slack integration" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok ? { delivered: true } : { delivered: false, reason: `slack responded ${res.status}` };
  } catch (err) {
    return { delivered: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
