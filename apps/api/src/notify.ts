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
