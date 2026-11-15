import type { Finding, ScanFailure, ScannedCheckpoint } from "@ariamend/core";
import type { GateResult } from "../types.js";

export interface RescanInput {
  findings: readonly Finding[];
  scanned: readonly ScannedCheckpoint[];
  failures: readonly ScanFailure[];
}

// A fix that adds or removes a sibling shifts :nth-child positions, so fingerprints of untouched
// findings change. Counting by this shape instead keeps those stable, while a finding that moves to
// a different kind of element still shows up as new.
function shape(finding: Finding): string {
  const selector = finding.normalizedSelector.replace(/:nth-(?:child|of-type)\(\d+\)/g, "");
  return [finding.ruleId, finding.target, finding.checkpoint, selector].join(" | ");
}

function count(findings: readonly Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(shape(finding), (counts.get(shape(finding)) ?? 0) + 1);
  return counts;
}

/**
 * Compare scans of the same checkpoints from before and after a fix.
 * Passes when the after scan really ran, fewer of the group's findings remain, and nothing new is reported.
 */
export function rescanGate(group: readonly Finding[], before: RescanInput, after: RescanInput): GateResult {
  const fail = (detail: string): GateResult => ({ gate: "rescan", passed: false, detail });

  // An empty result from a page that crashed or a journey that never reached its checkpoint is not a fix.
  if (after.failures.length > 0) {
    const first = after.failures[0];
    return fail(`The page could not be scanned after the change (${first?.target}: ${first?.message})`);
  }
  const reached = new Set(after.scanned.map((item) => `${item.target} | ${item.checkpoint}`));
  const missed = before.scanned.filter((item) => !reached.has(`${item.target} | ${item.checkpoint}`));
  if (missed.length > 0) {
    return fail(`The scan after the change did not reach ${missed[0]?.target} (${missed[0]?.checkpoint})`);
  }

  const was = count(before.findings);
  const now = count(after.findings);

  const regressions = [...now]
    .map(([key, has]) => ({ key, extra: has - (was.get(key) ?? 0) }))
    .filter((item) => item.extra > 0)
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  if (regressions.length > 0) {
    const list = regressions.map((item) => `${item.extra} x ${item.key}`).join("\n");
    return fail(
      `The change introduced or exposed new findings. Fix these too, without undoing the original fix:\n${list}`,
    );
  }

  const shapes = new Set(group.map(shape));
  const total = (counts: Map<string, number>) => [...shapes].reduce((sum, key) => sum + (counts.get(key) ?? 0), 0);
  const had = total(was);
  const has = total(now);
  if (had === 0) return fail("The findings were not present in the scan taken before the fix");
  if (has >= had) return fail(`${has} of ${had} finding(s) are still reported`);

  const remaining = has > 0 ? `, ${has} still reported` : "";
  return { gate: "rescan", passed: true, detail: `${had - has} of ${had} finding(s) cleared${remaining}` };
}
