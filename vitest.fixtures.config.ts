import { defineConfig } from "vitest/config";

// Fixture tests start a dev server and a real browser, so they run apart from the unit tests.
export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["fixtures/*/test/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 240_000,
    env: { ANTHROPIC_API_KEY: "" },
  },
});
