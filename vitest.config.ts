import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace packages to src/ so tests never depend on a stale build.
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    // Unit tests must never reach the network, model APIs included.
    env: { ANTHROPIC_API_KEY: "" },
  },
});
