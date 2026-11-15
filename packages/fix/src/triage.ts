import { createHash } from "node:crypto";
import type { SourceHint } from "@ariamend/adapters";
import type { Finding, Impact } from "@ariamend/core";
import { type FixTier, tierFor } from "./rule-tiers.js";
import type { FindingGroup } from "./types.js";

export interface TriageInput {
  findings: readonly Finding[];
  /** Source hints per fingerprint, best first. */
  hints: ReadonlyMap<string, readonly SourceHint[]>;
  ruleTiers?: Readonly<Record<string, FixTier>>;
  /** Fingerprints already covered by an open Ariamend pull request. */
  coveredByOpenPr?: ReadonlySet<string>;
  maxGroups: number;
}

export interface SkippedFinding {
  finding: Finding;
  reason: "report-tier" | "open-pr" | "limit";
}

export interface TriageResult {
  groups: FindingGroup[];
  skipped: SkippedFinding[];
}

const IMPACT_RANK: Record<Impact, number> = { critical: 4, serious: 3, moderate: 2, minor: 1, unknown: 0 };

function worstImpact(group: FindingGroup): number {
  return Math.max(...group.findings.map((finding) => IMPACT_RANK[finding.impact]));
}

// One edit to a component usually clears every instance of a rule in it, so that pair is the unit of work.
// Without a source hint, fall back to the selector with positions removed.
function groupKey(finding: Finding, hints: readonly SourceHint[]): string {
  const file = hints[0]?.file;
  const where = file ?? finding.normalizedSelector.replace(/:nth-(?:child|of-type)\(\d+\)/g, "");
  return `${finding.ruleId}\n${where}`;
}

/** Decide what to attempt and in what order. Plain code: no model is involved. */
export function triage(input: TriageInput): TriageResult {
  const skipped: SkippedFinding[] = [];
  const byKey = new Map<string, FindingGroup>();

  for (const finding of input.findings) {
    const tier = tierFor(finding.ruleId, input.ruleTiers);
    if (tier === "report") {
      skipped.push({ finding, reason: "report-tier" });
      continue;
    }
    if (input.coveredByOpenPr?.has(finding.fingerprint)) {
      skipped.push({ finding, reason: "open-pr" });
      continue;
    }

    const hints = input.hints.get(finding.fingerprint) ?? [];
    const key = groupKey(finding, hints);
    let group = byKey.get(key);
    if (group === undefined) {
      const id = createHash("sha256").update(key).digest("hex").slice(0, 12);
      group = { id, ruleId: finding.ruleId, tier, findings: [], hints: [] };
      byKey.set(key, group);
    }
    group.findings.push(finding);
    for (const hint of hints) {
      if (!group.hints.some((known) => known.file === hint.file && known.origin === hint.origin))
        group.hints.push(hint);
    }
  }

  const ordered = [...byKey.values()].sort(
    (a, b) =>
      worstImpact(b) - worstImpact(a) ||
      b.findings.length - a.findings.length ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const group of ordered.slice(input.maxGroups)) {
    for (const finding of group.findings) skipped.push({ finding, reason: "limit" });
  }
  return { groups: ordered.slice(0, input.maxGroups), skipped };
}
