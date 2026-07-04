import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`WankongOS API listening on http://localhost:${info.port}`);
  console.log(`Providers configured via env: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY`);
});
