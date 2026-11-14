import { type FixTier, tierFor } from "@altshift/fix";
import { type Finding, HONESTY, type ScanReport } from "altshift";

const TIER_ORDER: FixTier[] = ["auto", "auto-review", "suggest", "report"];

// Selectors and messages come from the scanned page. Control characters could rewrite the terminal.
function printable(text: string): string {
  return text.replace(/\p{Cc}+/gu, " ");
}

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
