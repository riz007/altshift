import type { SourceHint } from "@ariamend/adapters";
import type { Finding } from "@ariamend/core";
import type { FileChange } from "./diff.js";
import type { FixTier } from "./rule-tiers.js";

export const GATES = ["scope", "safety", "checks", "rescan", "visual", "build"] as const;
export type GateName = (typeof GATES)[number];

export interface GateResult {
  gate: GateName;
  passed: boolean;
  /** Shown to the model on retry and in the PR body. Never include secrets. */
  detail: string;
  /** Passed but needs a human look, e.g. an expected visual change. */
  flagged?: boolean;
}

export interface FindingGroup {
  id: string;
  ruleId: string;
  tier: FixTier;
  findings: Finding[];
  hints: SourceHint[];
}

export interface StagedEdit {
  path: string;
  oldString: string;
  newString: string;
  rationale: string;
}

export interface Attempt {
  model: string;
  edits: StagedEdit[];
  gates: GateResult[];
  costUsd: number;
  stopReason: "finish" | "give_up" | "refusal" | "max_turns" | "max_tokens" | "budget" | "error";
  /** The model's own summary, or its reason for giving up. Model output: escape before rendering. */
  summary?: string;
}

interface OutcomeBase {
  group: FindingGroup;
  attempts: Attempt[];
}

export type FixOutcome =
  | (OutcomeBase & {
      status: "accepted";
      changes: FileChange[];
      needsHumanReview: boolean;
      reviewNotes: string[];
    })
  | (OutcomeBase & { status: "suggested"; changes: FileChange[] })
  | (OutcomeBase & {
      status: "rejected";
      reason: string;
      failedGate?: GateName;
    })
  | (OutcomeBase & { status: "skipped"; reason: "budget" | "limit" });

export interface FixRunReport {
  schemaVersion: 1;
  mode: "debt" | "pr";
  dryRun: boolean;
  outcomes: FixOutcome[];
  /** Findings that were never attempted, by reason. */
  skippedFindings: { reportTier: number; openPr: number; limit: number };
  totalCostUsd: number;
  budgetUsd: number;
  models: string[];
  promptVersion: string;
}
