import type { Finding } from "@ariamend/core";
import { describe, expect, it } from "vitest";
import { buildEvidence, renderEvidence } from "./evidence.js";
import type { Attempt, FindingGroup, FixOutcome, FixRunReport, GateResult } from "./types.js";

const finding = (fingerprint: string, extra: Partial<Finding> = {}): Finding => ({
  fingerprint,
  engine: "axe",
  ruleId: "button-name",
  impact: "critical",
  target: "/",
  checkpoint: "load",
  url: "http://localhost:3000/",
  selector: ".wishlist",
  normalizedSelector: ".wishlist",
  htmlSnippet: "<button></button>",
  summary: "Buttons must have discernible text",
  helpUrl: "https://dequeuniversity.com/rules/axe/4.14/button-name",
  wcag: ["4.1.2"],
  ...extra,
});
const group = (id: string, ruleId: string, findings: Finding[], tier: FindingGroup["tier"] = "auto"): FindingGroup => ({
  id,
  ruleId,
  tier,
  findings,
  hints: [],
});
const gates = (flagSafety = false): GateResult[] => [
  { gate: "scope", passed: true, detail: "1 file(s), 2 changed line(s)" },
  {
    gate: "safety",
    passed: true,
    ...(flagSafety ? { flagged: true } : {}),
    detail: 'Draft: please review. New aria-label: "Close cart".',
  },
  { gate: "rescan", passed: true, detail: "1 of 1 finding(s) cleared" },
];
const attempt = (extra: Partial<Attempt> = {}): Attempt => ({
  model: "claude-fable-5-2",
  edits: [],
  gates: gates(true),
  costUsd: 0.09,
  stopReason: "finish",
  summary: "Added an accessible name to the close button.",
  ...extra,
});

const accepted: FixOutcome = {
  status: "accepted",
  group: group("g-close", "button-name", [finding("f1", { target: "cart-open", checkpoint: "drawer" })]),
  attempts: [attempt()],
  changes: [
    {
      path: "app/components/CartDrawer.vue",
      before: '<button class="close">',
      after: '<button class="close" aria-label="Close cart">',
    },
  ],
  needsHumanReview: true,
  reviewNotes: ['Draft: please review. New aria-label: "Close cart".'],
};
const suggested: FixOutcome = {
  status: "suggested",
  group: group(
    "g-contrast",
    "color-contrast",
    [finding("f2", { ruleId: "color-contrast", impact: "serious", wcag: ["1.4.3"] })],
    "suggest",
  ),
  attempts: [attempt({ gates: [{ gate: "scope", passed: true, detail: "" }] })],
  changes: [{ path: "app/assets/main.css", before: "--error: #f0616d;", after: "--error: #b42318;" }],
};
const rejected: FixOutcome = {
  status: "rejected",
  group: group("g-alt", "image-alt", [finding("f3", { ruleId: "image-alt", impact: "critical" })], "auto-review"),
  attempts: [
    attempt({
      gates: [
        { gate: "scope", passed: true, detail: "" },
        { gate: "safety", passed: false, detail: "adds v-html\nsecond line" },
      ],
    }),
  ],
  reason: "The safety gate failed: adds v-html",
  failedGate: "safety",
};
const skipped: FixOutcome = {
  status: "skipped",
  group: group("g-list", "list", [finding("f4", { ruleId: "list", impact: "serious" })]),
  attempts: [],
  reason: "budget",
};

const report = (...outcomes: FixOutcome[]): FixRunReport => ({
  schemaVersion: 1,
  mode: "debt",
  dryRun: false,
  outcomes,
  skippedFindings: { reportTier: 2, openPr: 1, limit: 0 },
  totalCostUsd: 0.27,
  budgetUsd: 5,
  models: ["claude-fable-5-2"],
  promptVersion: "0.3.0",
});

describe("buildEvidence", () => {
  const pack = buildEvidence(
    report(skipped, rejected, suggested, accepted),
    new Map([
      [
        "g-close",
        [{ target: "cart-open", checkpoint: "drawer", before: "screenshots/a.png", after: "screenshots/b.png" }],
      ],
    ]),
  );

  it("orders fixed, proposed, not fixed, then skipped, whatever the input order", () => {
    expect(pack.items.map((item) => item.status)).toEqual(["accepted", "suggested", "rejected", "skipped"]);
  });

  it("is identical for the same input in another order", () => {
    const again = buildEvidence(
      report(accepted, suggested, rejected, skipped),
      new Map([["g-close", pack.items[0]?.screenshots ?? []]]),
    );
    expect(JSON.stringify(again)).toBe(JSON.stringify(pack));
  });

  it("summarizes counts, cost and what was not attempted", () => {
    expect(pack.summary).toEqual({
      fixed: 1,
      findingsFixed: 1,
      proposed: 1,
      notFixed: 1,
      skipped: 1,
      notAttempted: { reportTier: 2, openPr: 1, limit: 0 },
      costUsd: 0.27,
      budgetUsd: 5,
      models: ["claude-fable-5-2"],
      promptVersion: "0.3.0",
    });
  });

  it("records for each finding the rule, WCAG criterion, files, gates, review notes and screenshots", () => {
    expect(pack.items[0]).toMatchObject({
      ruleId: "button-name",
      wcag: ["4.1.2"],
      impact: "critical",
      files: ["app/components/CartDrawer.vue"],
      gates: [
        { gate: "scope", result: "pass" },
        { gate: "safety", result: "review" },
        { gate: "rescan", result: "pass" },
      ],
      needsHumanReview: true,
      screenshots: [{ before: "screenshots/a.png", after: "screenshots/b.png" }],
      costUsd: 0.09,
    });
    expect(pack.items[2]).toMatchObject({
      status: "rejected",
      explanation: "The safety gate failed: adds v-html",
      gates: [{ result: "pass" }, { result: "fail" }],
    });
    expect(pack.items[3]?.explanation).toBe("The run's budget was used up before this group was reached.");
  });

  it("carries the honesty statements and makes no compliance claim", () => {
    expect(pack.statements.evidence).toContain("manual testing is still needed");
    expect(pack.statements.draft).toBe("Draft: please review.");
    expect(JSON.stringify(pack)).not.toMatch(/\b(compliant|ADA-ready|EAA-ready|fully accessible)\b/i);
  });
});

describe("renderEvidence", () => {
  const pack = buildEvidence(report(accepted, suggested, rejected, skipped));
  const full = renderEvidence(pack);

  it("puts the honesty statements near the top", () => {
    const top = full.split("\n").slice(0, 14).join("\n");
    expect(top).toContain(pack.statements.evidence);
    expect(top).toContain(pack.statements.fix);
  });

  it("has a section for each kind of result, with a check table and a diff", () => {
    expect(full).toContain("## Fixed");
    expect(full).toContain("## Proposed, not applied");
    expect(full).toContain("## Not fixed");
    expect(full).toContain("| No new code paths, nothing hidden or removed | Pass, needs review |");
    expect(full).toMatch(
      /```diff\n# app\/components\/CartDrawer\.vue\n- <button class="close">\n\+ <button class="close" aria-label="Close cart">\n```/,
    );
    expect(full).toContain("1 finding(s) are already covered by an open Ariamend pull request.");
  });

  it("shows only the first line of gate output, never a stack of detail", () => {
    expect(full).not.toContain("second line");
  });

  it("keeps model and page text from adding mentions, links, HTML or breaking out of tables and code blocks", () => {
    const hostile: FixOutcome = {
      ...accepted,
      attempts: [
        attempt({
          summary: "Done @octocat <!-- hidden --> [click](https://evil.example) <img src=x onerror=alert(1)> | col",
        }),
      ],
      changes: [{ path: "app/A.vue", before: "a", after: "```\n## Injected heading\n```" }],
      reviewNotes: ["note with @team and ](javascript:alert(1))"],
    };
    const text = renderEvidence(buildEvidence(report(hostile)));

    expect(text).not.toMatch(/@octocat|@team/);
    expect(text).not.toContain("<!--");
    expect(text).not.toContain("](https://evil.example)");
    expect(text).not.toContain("](javascript:");
    // Escaped as \<img, which Markdown shows as text.
    expect(text).not.toMatch(/(?<!\\)<img/);
    expect(text).toContain("\\<img");
    expect(text).not.toMatch(/^## Injected heading/m);
    // The diff fence must be longer than any backtick run inside it.
    expect(text).toContain("````diff");
  });

  it("writes a short pull request body with a table and no diffs", () => {
    const body = renderEvidence(pack, {
      summaryOnly: true,
      detailNote: "Full evidence is attached to the workflow run.",
    });
    expect(body).toContain("| Rule | Where | Findings | Result | Files |");
    expect(body).toContain("Fixed, needs review");
    expect(body).toContain("Proposed only");
    expect(body).toContain("Full evidence is attached to the workflow run.");
    expect(body).not.toContain("```diff");
  });

  it("names the checks that did not run instead of claiming every check passed", () => {
    const withAll = renderEvidence(buildEvidence(report(accepted)));
    expect(withAll).toContain("the project's own checks and the build.");
    expect(withAll).not.toContain("Not run:");

    const noChecks: FixOutcome = {
      ...accepted,
      attempts: [
        attempt({
          gates: [
            ...gates(true),
            { gate: "checks", passed: true, flagged: true, detail: "no checks configured in app.checks" },
            { gate: "build", passed: true, flagged: true, detail: "no build configured in app.build" },
          ],
        }),
      ],
    };
    const text = renderEvidence(buildEvidence(report(noChecks)));
    expect(text).not.toContain("the project's own checks");
    expect(text).toContain(
      "Not run: no project checks (such as typecheck or lint) are configured; no build command is configured.",
    );
  });

  it("says plainly when nothing was fixed", () => {
    const text = renderEvidence(buildEvidence(report(rejected)));
    expect(text).toContain("**Fixed:** 0 finding(s) in 0 change(s).");
    expect(text).not.toContain("## Fixed");
  });
});
