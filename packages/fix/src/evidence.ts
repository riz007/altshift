import { escapeUntrusted, type Finding, HONESTY, type Impact, inlineCode } from "@ariamend/core";
import { lineDiff } from "./diff.js";
import type { FixOutcome, FixRunReport, GateName } from "./types.js";

// The evidence pack is read by developers and by an agency's client. The JSON shape is a public
// contract: changing it is a breaking change and needs a schemaVersion bump.

export interface EvidenceGate {
  gate: GateName;
  result: "pass" | "review" | "fail";
  detail: string;
}

export interface EvidenceScreenshot {
  target: string;
  checkpoint: string;
  before: string;
  after: string;
}

export interface EvidenceItem {
  id: string;
  ruleId: string;
  tier: string;
  impact: Impact;
  wcag: string[];
  helpUrl: string;
  findings: Array<{ fingerprint: string; target: string; checkpoint: string; selector: string }>;
  status: FixOutcome["status"];
  /** The model's own account of the change, or the reason nothing was delivered. Model output. */
  explanation: string;
  files: string[];
  diff: Array<{ path: string; removed: string[]; added: string[] }>;
  gates: EvidenceGate[];
  needsHumanReview: boolean;
  reviewNotes: string[];
  screenshots: EvidenceScreenshot[];
  attempts: number;
  costUsd: number;
}

export interface EvidencePack {
  schemaVersion: 1;
  tool: "ariamend";
  mode: FixRunReport["mode"];
  dryRun: boolean;
  statements: { fix: string; evidence: string; draft: string };
  summary: {
    fixed: number;
    findingsFixed: number;
    proposed: number;
    notFixed: number;
    skipped: number;
    notAttempted: FixRunReport["skippedFindings"];
    costUsd: number;
    budgetUsd: number;
    models: string[];
    promptVersion: string;
  };
  items: EvidenceItem[];
}

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor", "unknown"];
const STATUS_ORDER: FixOutcome["status"][] = ["accepted", "suggested", "rejected", "skipped"];

function worstImpact(findings: readonly Finding[]): Impact {
  return IMPACT_ORDER.find((impact) => findings.some((finding) => finding.impact === impact)) ?? "unknown";
}

function toItem(outcome: FixOutcome, screenshots: readonly EvidenceScreenshot[]): EvidenceItem {
  const { group } = outcome;
  const last = outcome.attempts.at(-1);
  const changes = outcome.status === "accepted" || outcome.status === "suggested" ? outcome.changes : [];
  const explanation =
    outcome.status === "rejected" || outcome.status === "skipped"
      ? outcome.reason === "budget"
        ? "The run's budget was used up before this group was reached."
        : outcome.reason === "limit"
          ? "The run's limit on fixes was reached before this group."
          : outcome.reason
      : (last?.summary ?? "");

  return {
    id: group.id,
    ruleId: group.ruleId,
    tier: group.tier,
    impact: worstImpact(group.findings),
    wcag: [...new Set(group.findings.flatMap((finding) => finding.wcag))].sort(),
    helpUrl: group.findings[0]?.helpUrl ?? "",
    findings: group.findings
      .map(({ fingerprint, target, checkpoint, selector }) => ({ fingerprint, target, checkpoint, selector }))
      .sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1)),
    status: outcome.status,
    explanation,
    files: changes.map((change) => change.path).sort(),
    diff: changes.map((change) => ({ path: change.path, ...lineDiff(change.before, change.after) })),
    gates: (last?.gates ?? []).map((gate) => ({
      gate: gate.gate,
      result: !gate.passed ? "fail" : gate.flagged ? "review" : "pass",
      detail: gate.detail,
    })),
    needsHumanReview: outcome.status === "accepted" ? outcome.needsHumanReview : outcome.status === "suggested",
    reviewNotes: outcome.status === "accepted" ? [...outcome.reviewNotes] : [],
    screenshots: [...screenshots],
    attempts: outcome.attempts.length,
    costUsd: outcome.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0),
  };
}

/** Screenshot paths per group id, relative to the evidence folder. */
export type ScreenshotIndex = ReadonlyMap<string, readonly EvidenceScreenshot[]>;

export function buildEvidence(report: FixRunReport, screenshots: ScreenshotIndex = new Map()): EvidencePack {
  const items = report.outcomes
    .map((outcome) => toItem(outcome, screenshots.get(outcome.group.id) ?? []))
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) ||
        (a.id < b.id ? -1 : 1),
    );
  const count = (status: FixOutcome["status"]) => items.filter((item) => item.status === status).length;

  return {
    schemaVersion: 1,
    tool: "ariamend",
    mode: report.mode,
    dryRun: report.dryRun,
    statements: { fix: HONESTY.fix, evidence: HONESTY.evidence, draft: HONESTY.draft },
    summary: {
      fixed: count("accepted"),
      findingsFixed: items
        .filter((item) => item.status === "accepted")
        .reduce((sum, item) => sum + item.findings.length, 0),
      proposed: count("suggested"),
      notFixed: count("rejected"),
      skipped: count("skipped"),
      notAttempted: report.skippedFindings,
      costUsd: report.totalCostUsd,
      budgetUsd: report.budgetUsd,
      models: report.models,
      promptVersion: report.promptVersion,
    },
    items,
  };
}

const GATE_LABEL: Record<GateName, string> = {
  scope: "Only allowed files changed",
  safety: "No new code paths, nothing hidden or removed",
  checks: "Project checks",
  rescan: "Finding gone, nothing new",
  visual: "Page looks the same",
  build: "Project builds",
};
const RESULT_LABEL = { pass: "Pass", review: "Pass, needs review", fail: "Fail" } as const;

const firstLine = (text: string) => text.split("\n")[0] ?? "";
const where = (item: EvidenceItem, inTable = false) =>
  [...new Set(item.findings.map((finding) => `${finding.target} (${finding.checkpoint})`))]
    .sort()
    .map((text) => inlineCode(text, 200, inTable))
    .join(", ");
const wcag = (item: EvidenceItem) =>
  item.wcag.length > 0 ? `WCAG ${item.wcag.join(", ")}` : "no WCAG criterion listed";
const money = (value: number) => `$${value.toFixed(2)}`;

function diffBlock(item: EvidenceItem): string[] {
  if (item.diff.length === 0) return [];
  const lines = item.diff.flatMap((file) => [
    `# ${file.path}`,
    ...file.removed.map((line) => `- ${line.trim()}`),
    ...file.added.map((line) => `+ ${line.trim()}`),
  ]);
  // A longer fence than anything inside, so source text cannot close the block early.
  const longest = Math.max(2, ...lines.map((line) => /`+/.exec(line)?.[0].length ?? 0));
  const fence = "`".repeat(longest + 1);
  return [`${fence}diff`, ...lines, fence, ""];
}

function itemSection(item: EvidenceItem, heading: string): string[] {
  const lines = [
    `### ${heading}: ${inlineCode(item.ruleId)} on ${where(item)}`,
    "",
    `${item.findings.length} finding(s), impact ${item.impact}, ${wcag(item)}.`,
    "",
  ];
  if (item.explanation !== "") lines.push(`> ${escapeUntrusted(item.explanation, 600)}`, "");
  if (item.gates.length > 0) {
    lines.push("| Check | Result | Detail |", "| --- | --- | --- |");
    for (const gate of item.gates) {
      lines.push(
        `| ${GATE_LABEL[gate.gate]} | ${RESULT_LABEL[gate.result]} | ${escapeUntrusted(firstLine(gate.detail), 200)} |`,
      );
    }
    lines.push("");
  }
  if (item.needsHumanReview && item.reviewNotes.length > 0) {
    lines.push(
      "Please check:",
      "",
      ...item.reviewNotes.map((note) => `- ${escapeUntrusted(firstLine(note), 300)}`),
      "",
    );
  }
  lines.push(...diffBlock(item));
  for (const shot of item.screenshots) {
    lines.push(
      `Screenshots for ${inlineCode(`${shot.target} (${shot.checkpoint})`)}: [before](${shot.before}), [after](${shot.after})`,
      "",
    );
  }
  return lines;
}

export interface RenderOptions {
  /** Shown in place of the full detail, e.g. where the evidence files were uploaded. */
  detailNote?: string;
  /** Leave out diffs, gate tables and screenshots. Used for the pull request body. */
  summaryOnly?: boolean;
}

/** The evidence pack as Markdown. Written for a reviewer and for an agency's client: no stack traces, no jargon. */
export function renderEvidence(pack: EvidencePack, options: RenderOptions = {}): string {
  const { summary } = pack;
  const fixed = pack.items.filter((item) => item.status === "accepted");
  const proposed = pack.items.filter((item) => item.status === "suggested");
  const notFixed = pack.items.filter((item) => item.status === "rejected" || item.status === "skipped");
  const drafts = fixed.filter((item) => item.needsHumanReview).length;
  // Say which checks did not run, rather than let "passed every check" cover them.
  const unconfigured = (gate: GateName, prefix: string) =>
    fixed.some((item) => item.gates.some((result) => result.gate === gate && result.detail.startsWith(prefix)));
  const missing = [
    ...(unconfigured("checks", "no checks configured")
      ? ["no project checks (such as typecheck or lint) are configured"]
      : []),
    ...(unconfigured("build", "no build configured") ? ["no build command is configured"] : []),
  ];
  const ran = `Each passed the scope and safety checks, a rescan and a visual comparison${missing.length === 0 ? ", the project's own checks and the build" : ""}.`;

  const lines = [
    "## Ariamend evidence",
    "",
    `- **Fixed:** ${summary.findingsFixed} finding(s) in ${summary.fixed} change(s). ${ran}${missing.length > 0 ? ` Not run: ${missing.join("; ")}.` : ""}`,
    `- **Needs your review:** ${drafts} of those include wording or choices a person must check.`,
    `- **Proposed only:** ${summary.proposed}. These change how the page looks, so they are shown here and not applied.`,
    `- **Not fixed:** ${summary.notFixed + summary.skipped}.`,
    `- **Cost:** ${money(summary.costUsd)} of a ${money(summary.budgetUsd)} budget. Model: ${summary.models.map((model) => inlineCode(model)).join(", ") || "none"}.`,
    "",
    `> ${pack.statements.evidence}`,
    ">",
    `> ${pack.statements.fix}`,
    "",
  ];
  if (drafts > 0)
    lines.push(
      `Text that a model wrote, such as a button name or image description, is marked "${pack.statements.draft}"`,
      "",
    );

  if (options.summaryOnly) {
    const row = (item: EvidenceItem, state: string) =>
      `| ${inlineCode(item.ruleId, 200, true)} | ${where(item, true)} | ${item.findings.length} | ${state} | ${item.files.map((file) => inlineCode(file, 200, true)).join(", ")} |`;
    if (pack.items.length > 0) {
      lines.push("| Rule | Where | Findings | Result | Files |", "| --- | --- | --- | --- | --- |");
      for (const item of fixed) lines.push(row(item, item.needsHumanReview ? "Fixed, needs review" : "Fixed"));
      for (const item of proposed) lines.push(row(item, "Proposed only"));
      for (const item of notFixed) lines.push(row(item, "Not fixed"));
      lines.push("");
    }
    if (options.detailNote) lines.push(options.detailNote, "");
    return lines.join("\n");
  }

  if (fixed.length > 0)
    lines.push(
      "## Fixed",
      "",
      ...fixed.flatMap((item) => itemSection(item, item.needsHumanReview ? "Fixed, needs review" : "Fixed")),
    );
  if (proposed.length > 0)
    lines.push("## Proposed, not applied", "", ...proposed.flatMap((item) => itemSection(item, "Proposal")));
  if (notFixed.length > 0)
    lines.push("## Not fixed", "", ...notFixed.flatMap((item) => itemSection(item, "Not fixed")));

  const { notAttempted } = summary;
  if (notAttempted.reportTier + notAttempted.openPr + notAttempted.limit > 0) {
    lines.push(
      "## Not attempted",
      "",
      `- ${notAttempted.reportTier} finding(s) need content only a person can supply, or use a rule Ariamend does not fix.`,
      `- ${notAttempted.openPr} finding(s) are already covered by an open Ariamend pull request.`,
      `- ${notAttempted.limit} finding(s) were over this run's limit and will be picked up next time.`,
      "",
    );
  }
  return lines.join("\n");
}
