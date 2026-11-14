import { AxeBuilder } from "@axe-core/playwright";
import { IMPACTS, type Impact } from "../types.js";
import type { RawFinding, ScanEngine } from "./types.js";

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;
export type AxeViolations = AxeResults["violations"];

const SNIPPET_LIMIT = 500;

/** axe tags such as "wcag111" or "wcag1410" become "1.1.1" and "1.4.10". Level tags ("wcag2aa") are skipped. */
export function wcagCriteria(tags: readonly string[]): string[] {
  const criteria = new Set<string>();
  for (const tag of tags) {
    const match = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (match) criteria.add(`${match[1]}.${match[2]}.${match[3]}`);
  }
  return [...criteria].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function toImpact(value: string | null | undefined): Impact {
  return (IMPACTS as readonly string[]).includes(value ?? "") ? (value as Impact) : "unknown";
}

/** One finding per failing element. Frames and shadow roots are joined into a single selector string. */
export function fromAxeViolations(violations: AxeViolations): RawFinding[] {
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      ruleId: violation.id,
      impact: toImpact(node.impact ?? violation.impact),
      selector: node.target.map((part) => (Array.isArray(part) ? part.join(" >>> ") : part)).join(" | "),
      htmlSnippet: node.html.slice(0, SNIPPET_LIMIT),
      summary: violation.help,
      helpUrl: violation.helpUrl,
      wcag: wcagCriteria(violation.tags),
    })),
  );
}

export const axeEngine: ScanEngine = {
  id: "axe",
  async scan(page, options) {
    let builder = new AxeBuilder({ page }).withTags(options.tags);
    for (const selector of options.include) builder = builder.include(selector);
    for (const selector of options.exclude) builder = builder.exclude(selector);
    const results = await builder.analyze();
    return {
      engineVersion: results.testEngine.version,
      findings: fromAxeViolations(results.violations),
    };
  },
};
