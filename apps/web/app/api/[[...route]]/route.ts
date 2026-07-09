import { Hono } from "hono";
import { handle } from "hono/vercel";
import { getApiApp } from "@/lib/server-api";

/**
 * Expose the embedded WankongOS API to the browser under `/api/*`.
 *
 * The same singleton Hono app that server components call in-process is
 * mounted here for client-side calls (streaming chat, the workflow run panel),
 * so browser and server always see one consistent in-memory store.
 */
export const dynamic = "force-dynamic";

const app = new Hono().route("/api", getApiApp());
const handler = handle(app);

export {
  handler as GET,
  handler as POST,
  handler as PATCH,
  handler as PUT,
  handler as DELETE,
  handler as OPTIONS,
};
