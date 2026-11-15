import { type FixOutcome, type FixRunReport, type FixTier, lineDiff, tierFor } from "@altshift/fix";
import { type Finding, HONESTY, printable, type ScanReport } from "altshift";

const TIER_ORDER: FixTier[] = ["auto", "auto-review", "suggest", "report"];

function groupKey(finding: Pick<Finding, "target" | "checkpoint">): string {
  return `${finding.target}  (${finding.checkpoint})`;
}

export function formatScanReport(report: ScanReport, ruleTiers: Readonly<Record<string, FixTier>> = {}): string {
  const lines: string[] = [];
  lines.push(`AltShift scan: ${report.engine.id} ${report.engine.version}, ${report.scanned.length} checkpoint(s)`, "");

  const groups = new Map<string, Finding[]>();
  for (const checkpoint of report.scanned) groups.set(groupKey(checkpoint), []);
  for (const finding of report.findings) groups.get(groupKey(finding))?.push(finding);

  for (const [title, findings] of groups) {
    lines.push(title);
    if (findings.length === 0) lines.push("  no findings");
    for (const finding of findings) {
      const tier = tierFor(finding.ruleId, ruleTiers);
      lines.push(
        `  ${finding.impact.padEnd(9)} ${finding.ruleId.padEnd(24)} ${tier.padEnd(12)} ${printable(finding.selector)}`,
      );
      lines.push(`  ${" ".repeat(9)} ${printable(finding.summary)}`);
    }
    lines.push("");
  }

  if (report.failures.length > 0) {
    lines.push("Could not scan");
    for (const failure of report.failures) lines.push(`  ${failure.target}: ${printable(failure.message)}`);
    lines.push("");
  }

  const perTier = TIER_ORDER.map((tier) => {
    const count = report.findings.filter((finding) => tierFor(finding.ruleId, ruleTiers) === tier).length;
    return `${count} ${tier}`;
  });
  lines.push(`${report.findings.length} finding(s): ${perTier.join(", ")}`);
  lines.push("", HONESTY.scan, "");
  return lines.join("\n");
}

const STATUS: Record<FixOutcome["status"], string> = {
  accepted: "FIXED",
  suggested: "PROPOSAL",
  rejected: "COULD NOT FIX",
  skipped: "SKIPPED",
};

function diffLines(outcome: FixOutcome): string[] {
  if (outcome.status !== "accepted" && outcome.status !== "suggested") return [];
  return outcome.changes.flatMap((change) => {
    const diff = lineDiff(change.before, change.after);
    return [
      `    ${printable(change.path)}`,
      ...diff.removed.map((line) => `    - ${printable(line)}`),
      ...diff.added.map((line) => `    + ${printable(line)}`),
    ];
  });
}

export function formatFixReport(report: FixRunReport): string {
  const lines: string[] = [`AltShift fix${report.dryRun ? " (dry run: your files are unchanged)" : ""}`, ""];

  for (const outcome of report.outcomes) {
    const { group } = outcome;
    const where = [...new Set(group.findings.map((finding) => `${finding.target} (${finding.checkpoint})`))].join(", ");
    lines.push(`${STATUS[outcome.status]}  ${group.ruleId}  ${group.findings.length} finding(s) on ${where}`);

    const last = outcome.attempts.at(-1);
    if (last?.summary) lines.push(`  ${printable(last.summary).slice(0, 400)}`);
    if (outcome.status === "rejected" || outcome.status === "skipped")
      lines.push(`  Reason: ${printable(outcome.reason)}`);
    for (const gate of last?.gates ?? []) {
      const state = !gate.passed ? "fail" : gate.flagged ? "pass, review" : "pass";
      lines.push(`  ${gate.gate.padEnd(7)} ${state.padEnd(13)} ${printable(gate.detail.split("\n")[0] ?? "")}`);
    }
    if (outcome.status === "accepted" && outcome.needsHumanReview) {
      for (const note of outcome.reviewNotes) lines.push(`  Review: ${printable(note)}`);
    }
    lines.push(...diffLines(outcome));
    const cost = outcome.attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
    if (outcome.attempts.length > 0) lines.push(`  ${outcome.attempts.length} attempt(s), $${cost.toFixed(4)}`);
    lines.push("");
  }

  const tally = (status: FixOutcome["status"]) => report.outcomes.filter((outcome) => outcome.status === status).length;
  lines.push(
    `${tally("accepted")} fixed, ${tally("suggested")} proposed, ${tally("rejected")} could not be fixed, ${tally("skipped")} skipped`,
    `Cost: $${report.totalCostUsd.toFixed(4)} of a $${report.budgetUsd.toFixed(2)} budget. Models: ${report.models.join(", ") || "none"}. Prompt ${report.promptVersion}.`,
    "",
    HONESTY.fix,
    "",
  );
  return lines.join("\n");
}
