import type { SourceHint } from "@altshift/adapters";
import type { Finding } from "altshift";
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
  stopReason: "finish" | "give_up" | "refusal" | "max_turns" | "error";
}

export type FixOutcome =
  | { status: "accepted"; group: FindingGroup; attempts: Attempt[]; needsHumanReview: boolean; reviewNotes?: string }
  | { status: "suggested"; group: FindingGroup; attempts: Attempt[] }
  | { status: "rejected"; group: FindingGroup; attempts: Attempt[]; failedGate: GateName }
  | { status: "skipped"; group: FindingGroup; reason: "report-tier" | "budget" | "limit" | "out-of-scope" };

export interface FixRunReport {
  schemaVersion: 1;
  mode: "fix" | "debt";
  outcomes: FixOutcome[];
  totalCostUsd: number;
  budgetUsd: number;
  promptVersion: string;
}
