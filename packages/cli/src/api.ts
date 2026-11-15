// The public API: what an ariamend.config.ts or a journey file imports.
//
// Written out in full rather than re-exported, because the internal packages are bundled and not
// published, so their types cannot be referenced from here. api.check.ts fails the type check if
// these drift from the schema the runner validates against.

import type { Page } from "playwright";

export type FixTier = "auto" | "auto-review" | "suggest" | "report";

/** Everything is optional. Defaults are listed in the README. */
export interface AriamendConfig {
  app?: {
    /** "auto" detects the framework from package.json. */
    framework?: "auto" | "next" | "nuxt" | "sveltekit" | "astro" | "react-router" | "angular" | "vite";
    /** The dev server Ariamend starts, scans and rescans. Required for scan and fix. */
    dev?: {
      command: string;
      /** http or https origin of the dev server, e.g. http://localhost:3000. */
      url: string;
      readyTimeoutSeconds?: number;
    };
    /** Run once on all kept fixes. A fix that breaks it is dropped. */
    build?: string;
    /** Each must pass with every fix applied, e.g. "pnpm typecheck", "pnpm lint". */
    checks?: string[];
    /** Limit for each check command and for the build. */
    commandTimeoutSeconds?: number;
  };
  targets?: {
    /** Paths on the dev server, each starting with a single "/". Never full URLs. */
    pages?: string[];
    /** Glob of journey files, relative to the config file. */
    journeys?: string;
    /** Selectors left out of every scan, e.g. third-party widgets. */
    exclude?: string[];
  };
  scan?: {
    engine?: "axe" | "accesslint";
    /** axe-core tags to run. */
    tags?: string[];
  };
  fix?: {
    /** Files the model may read and change, as globs relative to the project root. */
    allowPaths?: string[];
    denyPaths?: string[];
    maxFixesPerRun?: number;
    maxAttemptsPerFinding?: number;
    /** Spending cap for one run, in USD. */
    budgetUsd?: number;
    /** Largest share of pixels that may change before the visual check fails, from 0 to 1. */
    visualDiffThreshold?: number;
    /** Per-rule overrides of the default tiers. */
    ruleTiers?: Record<string, FixTier>;
    models?: { fix?: string; triage?: string; fallback?: string };
  };
}

export interface CheckOptions {
  /** Extra selectors to exclude for this check point only. */
  exclude?: string[];
  /** Limit the scan to these selectors. */
  include?: string[];
}

export interface JourneyContext {
  page: Page;
  /** Scan the page as it is right now. Names must be unique within a journey. */
  check(name: string, options?: CheckOptions): Promise<void>;
}

export interface Journey {
  /** Letters, digits and dashes. Used as the target name in findings. */
  name: string;
  run(ctx: JourneyContext): Promise<void>;
}

export function defineConfig(config: AriamendConfig): AriamendConfig {
  return config;
}

export function defineJourney(journey: Journey): Journey {
  return journey;
}
