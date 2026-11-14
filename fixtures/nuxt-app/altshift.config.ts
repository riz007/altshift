import { defineConfig } from "altshift";

export default defineConfig({
  app: {
    framework: "nuxt",
    dev: { command: "pnpm dev", url: "http://localhost:3210" },
    build: "pnpm build",
  },
  targets: {
    // "/shipping" has no seeded violations. It guards against false positives.
    pages: ["/", "/products/trail-mug", "/shipping"],
    journeys: "./journeys/*.journey.ts",
  },
  fix: {
    allowPaths: ["app/**"],
  },
});
