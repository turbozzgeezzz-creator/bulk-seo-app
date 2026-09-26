import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests don't load the React Router / Shopify dev plugins.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    env: { DISABLE_JOB_WORKER: "1" },
    // Runner tests share one Postgres database, so files run one at a time.
    fileParallelism: false,
  },
});
