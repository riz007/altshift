// Example config for a Nuxt storefront.
import { defineConfig } from "altshift";

export default defineConfig({
  app: {
    framework: "auto",
    dev: { command: "pnpm dev", url: "http://localhost:3000" },
    build: "pnpm build",
    checks: ["pnpm typecheck", "pnpm lint"],
  },

  targets: {
    pages: ["/", "/products/test-shirt", "/cart"],
    journeys: "./journeys/*.journey.ts",
    exclude: [".third-party-chat-widget"],
  },

  scan: {
    engine: "axe",
    tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  },

  fix: {
    allowPaths: ["components/**", "pages/**", "layouts/**", "app/**"],
    denyPaths: ["**/*.test.*", "**/*.spec.*", "public/**"],
    maxFixesPerRun: 10,
    budgetUsd: 5,
  },
});
