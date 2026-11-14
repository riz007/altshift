import { z } from "zod";
import { ENGINES } from "./types.js";

// Removing or renaming a field here is a breaking change (AGENTS.md).

const fixTier = z.enum(["auto", "auto-review", "suggest", "report"]);

const appSchema = z.strictObject({
  framework: z.enum(["auto", "next", "nuxt", "sveltekit", "astro", "react-router", "angular", "vite"]).default("auto"),
  dev: z
    .strictObject({
      command: z.string().min(1),
      url: z.url({ protocol: /^https?$/ }),
      readyTimeoutSeconds: z.number().int().positive().default(90),
    })
    .optional(),
  build: z.string().min(1).optional(),
  checks: z.array(z.string().min(1)).default([]),
});

// Paths only. The origin always comes from app.dev.url, so a config cannot point a scan at another site.
const pagePath = z
  .string()
  .regex(/^\/(?!\/)/, 'Page targets are paths on the dev server and must start with a single "/"');

const targetsSchema = z.strictObject({
  pages: z.array(pagePath).default(["/"]),
  /** Glob of journey files, relative to the config file. */
  journeys: z.string().min(1).optional(),
  /** Selectors left out of every scan, e.g. third-party widgets. */
  exclude: z.array(z.string().min(1)).default([]),
});

const scanSchema = z.strictObject({
  engine: z.enum(ENGINES).default("axe"),
  tags: z.array(z.string().min(1)).min(1).default(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]),
});

const fixSchema = z.strictObject({
  allowPaths: z.array(z.string()).default(["app/**", "pages/**", "components/**", "src/**", "layouts/**"]),
  denyPaths: z.array(z.string()).default(["**/*.test.*", "**/*.spec.*", "public/**"]),
  maxFixesPerRun: z.number().int().positive().max(50).default(10),
  maxAttemptsPerFinding: z.number().int().min(1).max(3).default(2),
  budgetUsd: z.number().positive().max(100).default(5),
  visualDiffThreshold: z.number().min(0).max(1).default(0.02),
  /** Per-rule overrides of the default tiers in packages/fix/src/rule-tiers.ts. */
  ruleTiers: z.record(z.string(), fixTier).default({}),
  models: z
    .strictObject({
      fix: z.string().optional(),
      triage: z.string().optional(),
      fallback: z.string().optional(),
    })
    .default({}),
});

export const configSchema = z.strictObject({
  app: appSchema.prefault({}),
  targets: targetsSchema.prefault({}),
  scan: scanSchema.prefault({}),
  fix: fixSchema.prefault({}),
});

/** What users write. Every field is optional. */
export type AltshiftConfig = z.input<typeof configSchema>;
/** What the runner uses, with defaults filled in. */
export type ResolvedConfig = z.output<typeof configSchema>;

export function defineConfig(config: AltshiftConfig): AltshiftConfig {
  return config;
}

export function resolveConfig(input: unknown): ResolvedConfig {
  return configSchema.parse(input);
}
