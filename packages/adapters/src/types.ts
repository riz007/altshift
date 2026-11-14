import type { Page } from "playwright";

export type FrameworkId = "next" | "nuxt" | "sveltekit" | "astro" | "react-router" | "angular" | "vite";

export interface DetectResult {
  framework: FrameworkId;
  version?: string;
  confidence: "high" | "low";
  /** Human-readable reasons, e.g. "next@16.0.1 in dependencies". */
  evidence: string[];
}

export type SourceHintOrigin =
  | "vue-component-file"
  | "svelte-meta"
  | "astro-source-attr"
  | "react-owner-name"
  | "angular-component"
  | "annotation-plugin"
  | "heuristic";

export interface SourceHint {
  /** Repo-relative path when known. */
  file?: string;
  line?: number;
  column?: number;
  /** Component name when the file is unknown, used for search. */
  component?: string;
  origin: SourceHintOrigin;
  /** 0 to 1. Hints narrow the search; the agent still confirms by reading the file. */
  confidence: number;
}

export interface AdapterDefaults {
  devCommand: string;
  buildCommand: string;
  url: string;
  sourceGlobs: string[];
  templateExtensions: string[];
}

export interface FrameworkAdapter {
  id: FrameworkId;
  displayName: string;
  detect(repoRoot: string): Promise<DetectResult | null>;
  defaults: AdapterDefaults;
  /** Runs against the dev server. Must not throw: return [] when nothing is found. Files are repo-relative. */
  collectSourceHints(page: Page, selector: string, repoRoot: string): Promise<SourceHint[]>;
  /** Short Markdown added to the fix prompt. Keep under 25 lines. */
  promptNotes: string;
}
