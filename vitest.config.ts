import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@wankong/core": r("./packages/core/src/index.ts"),
      "@wankong/agents": r("./packages/agents/src/index.ts"),
      "@wankong/store": r("./packages/store/src/index.ts"),
      "@wankong/workflow": r("./packages/workflow/src/index.ts"),
      "@wankong/knowledge": r("./packages/knowledge/src/index.ts"),
      "@wankong/evals": r("./packages/evals/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    passWithNoTests: false,
  },
});
