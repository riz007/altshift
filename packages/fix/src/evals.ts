import { z } from "zod";
import { lineDiff } from "./diff.js";
import type { FixOutcome, FixRunReport } from "./types.js";

export const evalCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  fixture: z.string().regex(/^[a-z0-9-]+$/),
  target: z.string().min(1),
  checkpoint: z.string().min(1),
  ruleId: z.string().min(1),
  expect: z.strictObject({
    outcome: z.enum(["accepted", "suggested", "rejected"]),
    /** Files a good fix may touch. Any other changed file fails the case. */
    files: z.array(z.string()).default([]),
    /** Each must appear in the lines the fix adds. */
    mustContain: z.array(z.string()).default([]),
    mustNotContain: z.array(z.string()).default([]),
    /** Regular expressions, case-insensitive, that the added lines must not match. */
    mustNotMatch: z.array(z.string()).default([]),
    /** Each must still be in a changed file afterwards. Catches a fix that deletes or rewrites what it should keep. */
    mustKeep: z.array(z.string()).default([]),
    /** When true, the safety gate must have marked the fix for human review. */
    flagged: z.boolean().optional(),
  }),
  notes: z.string().optional(),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export interface CaseResult {
  id: string;
  passed: boolean;
  /** What happened, or "not-attempted" when no group covered the case's finding. */
  status: FixOutcome["status"] | "not-attempted";
  failedGate?: string;
  attempts: number;
  costUsd: number;
  reasons: string[];
  /** Gates that rejected an earlier attempt, first line of each. */
  gateFailures: string[];
  /** The change as "- removed" and "+ added" lines per file, for judging the fix by hand. */
  diff: string[];
}

export interface EvalSummary {
  cases: number;
  passed: number;
  /** Of the cases that expect a delivered fix, the share that passed every gate and every check here. */
  fixRate: number | null;
  /** Attempts that the rescan gate rejected for introducing findings, over all gated attempts. */
  regressionRate: number | null;
  costUsd: number;
  costPerAcceptedFixUsd: number | null;
  refusals: number;
  fallbacks: number;
}

export function scoreCase(testCase: EvalCase, report: FixRunReport): CaseResult {
  const outcome = report.outcomes.find((item) =>
    item.group.findings.some(
      (finding) =>
        finding.ruleId === testCase.ruleId &&
        finding.target === testCase.target &&
        finding.checkpoint === testCase.checkpoint,
    ),
  );
  if (outcome === undefined) {
    return {
      id: testCase.id,
      passed: false,
      status: "not-attempted",
      attempts: 0,
      costUsd: 0,
      reasons: ["no group covered this finding"],
      gateFailures: [],
      diff: [],
    };
  }

  const reasons: string[] = [];
  if (outcome.status !== testCase.expect.outcome) {
    const why = outcome.status === "rejected" || outcome.status === "skipped" ? `: ${outcome.reason}` : "";
    reasons.push(`expected ${testCase.expect.outcome}, got ${outcome.status}${why}`);
  }

  const diff: string[] = [];
  if (outcome.status === "accepted" || outcome.status === "suggested") {
    for (const change of outcome.changes) {
      const lines = lineDiff(change.before, change.after);
      diff.push(
        change.path,
        ...lines.removed.map((line) => `- ${line.trim()}`),
        ...lines.added.map((line) => `+ ${line.trim()}`),
      );
    }
    const added = outcome.changes.map((change) => lineDiff(change.before, change.after).added.join("\n")).join("\n");
    const allowed = testCase.expect.files;
    for (const change of outcome.changes) {
      if (allowed.length > 0 && !allowed.includes(change.path))
        reasons.push(`changed ${change.path}, which the case does not allow`);
    }
    for (const text of testCase.expect.mustContain)
      if (!added.includes(text)) reasons.push(`the fix does not add ${JSON.stringify(text)}`);
    for (const text of testCase.expect.mustNotContain)
      if (added.includes(text)) reasons.push(`the fix adds ${JSON.stringify(text)}`);
    for (const pattern of testCase.expect.mustNotMatch) {
      if (new RegExp(pattern, "i").test(added)) reasons.push(`the fix matches /${pattern}/`);
    }
    const final = outcome.changes.map((change) => change.after).join("\n");
    for (const text of testCase.expect.mustKeep) {
      if (!final.includes(text)) reasons.push(`the fix lost ${JSON.stringify(text)}`);
    }
    const safety = outcome.attempts.at(-1)?.gates.find((gate) => gate.gate === "safety");
    if (testCase.expect.flagged && outcome.status === "accepted" && !safety?.flagged) {
      reasons.push("the fix was not marked for human review");
    }
  }

  return {
    id: testCase.id,
    passed: reasons.length === 0,
    status: outcome.status,
    ...(outcome.status === "rejected" && outcome.failedGate ? { failedGate: outcome.failedGate } : {}),
    attempts: outcome.attempts.length,
    costUsd: outcome.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0),
    reasons,
    gateFailures: outcome.attempts.flatMap((attempt) =>
      attempt.gates.filter((gate) => !gate.passed).map((gate) => `${gate.gate}: ${gate.detail.split("\n")[0]}`),
    ),
    diff,
  };
}

export function summarize(
  cases: readonly EvalCase[],
  results: readonly CaseResult[],
  reports: readonly FixRunReport[],
): EvalSummary {
  const attempts = reports.flatMap((report) => report.outcomes.flatMap((outcome) => outcome.attempts));
  const gated = attempts.filter((attempt) => attempt.gates.some((gate) => gate.gate === "rescan"));
  const regressed = gated.filter((attempt) =>
    attempt.gates.some((gate) => gate.gate === "rescan" && !gate.passed && gate.detail.includes("new findings")),
  );
  const wantFix = cases.filter((item) => item.expect.outcome === "accepted").map((item) => item.id);
  const fixed = results.filter((result) => wantFix.includes(result.id) && result.passed);
  const accepted = reports
    .flatMap((report) => report.outcomes)
    .filter((outcome) => outcome.status === "accepted").length;
  const costUsd = reports.reduce((sum, report) => sum + report.totalCostUsd, 0);
  const fallbackModels = new Set(attempts.map((attempt) => attempt.model)).size;

  return {
    cases: cases.length,
    passed: results.filter((result) => result.passed).length,
    fixRate: wantFix.length > 0 ? fixed.length / wantFix.length : null,
    regressionRate: gated.length > 0 ? regressed.length / gated.length : null,
    costUsd,
    costPerAcceptedFixUsd: accepted > 0 ? costUsd / accepted : null,
    refusals: attempts.filter((attempt) => attempt.stopReason === "refusal").length,
    fallbacks: Math.max(0, fallbackModels - 1),
  };
}
