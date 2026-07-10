import { createAppContext, runScheduledWorkflows, runWorkCycle } from "@wankong/api";

/**
 * The background worker: drives the scheduler tick once per minute against
 * the same store the API uses (share a DATABASE_URL to coordinate with a
 * separately-deployed API; without one this worker runs its own in-memory
 * world, useful for local scheduling demos).
 *
 * On serverless hosting, point a platform cron at `POST /v1/worker/tick`
 * instead — the tick is idempotent per minute either way.
 */
const context = createAppContext();

async function tick(): Promise<void> {
  try {
    await context.ready;
    const result = await runScheduledWorkflows(context);
    const work = await runWorkCycle(context);
    if (result.started.length > 0 || work.completed.length > 0 || work.approvalsRequested.length > 0) {
      console.log(
        `[worker] tick: workflows started=${result.started.length} · tasks completed=${work.completed.length} approvals=${work.approvalsRequested.length} skipped=${work.skipped.length}`,
      );
    }
  } catch (err) {
    console.error("[worker] tick failed:", err);
  }
}

console.log("WankongOS worker started — scheduler + autonomous work cycle every 60s");
void tick();
setInterval(() => void tick(), 60_000);
