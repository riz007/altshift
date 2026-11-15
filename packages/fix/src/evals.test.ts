import { describe, expect, it } from "vitest";
import {
  type EvalCase,
  evalCaseSchema,
  scoreCase,
  summarize,
} from "./evals.js";
import type { Attempt, FixOutcome, FixRunReport, GateResult } from "./types.js";

const FILE = "app/components/CartDrawer.vue";
const group = {
  id: "g1",
  ruleId: "button-name",
  tier: "auto" as const,
  hints: [],
  findings: [
    { ruleId: "button-name", target: "cart-open", checkpoint: "drawer" },
  ] as never,
};
const gate = (
  name: GateResult["gate"],
  passed = true,
  detail = "",
): GateResult => ({ gate: name, passed, detail });
const attempt = (extra: Partial<Attempt> = {}): Attempt => ({
  model: "claude-fable-5-2",
  edits: [],
  gates: [
    gate("scope"),
    gate("safety"),
    gate("checks"),
    gate("rescan"),
    gate("visual"),
  ],
  costUsd: 0.1,
  stopReason: "finish",
  ...extra,
});
const accepted: FixOutcome = {
  status: "accepted",
  group,
  attempts: [attempt()],
  changes: [
    {
      path: FILE,
      before: '<button class="close">',
      after: '<button class="close" aria-label="Close cart">',
    },
  ],
  needsHumanReview: true,
  reviewNotes: [],
};
const report = (...outcomes: FixOutcome[]): FixRunReport => ({
  schemaVersion: 1,
  mode: "debt",
  dryRun: true,
  outcomes,
  skippedFindings: { reportTier: 0, openPr: 0, limit: 0 },
  totalCostUsd: outcomes
    .flatMap((outcome) => outcome.attempts)
    .reduce((sum, item) => sum + item.costUsd, 0),
  budgetUsd: 5,
  models: ["claude-fable-5-2"],
  promptVersion: "0.2.0",
});
const testCase: EvalCase = evalCaseSchema.parse({
  id: "nuxt-button-name-cart-close",
  fixture: "nuxt-app",
  target: "cart-open",
  checkpoint: "drawer",
  ruleId: "button-name",
  expect: {
    outcome: "accepted",
    files: [FILE],
    mustContain: ["aria-label"],
    mustNotContain: ['aria-hidden="true"'],
  },
});

describe("scoreCase", () => {
  it("passes an accepted fix that meets every expectation", () => {
    expect(scoreCase(testCase, report(accepted))).toEqual({
      id: testCase.id,
      passed: true,
      status: "accepted",
      attempts: 1,
      costUsd: 0.1,
      reasons: [],
      gateFailures: [],
      diff: [
        FILE,
        '- <button class="close">',
        '+ <button class="close" aria-label="Close cart">',
      ],
    });
  });

  it("fails when the fix was rejected, and names the gate", () => {
    const rejected: FixOutcome = {
      status: "rejected",
      group,
      attempts: [attempt()],
      reason: "The visual gate failed",
      failedGate: "visual",
    };
    const result = scoreCase(testCase, report(rejected));
    expect(result).toMatchObject({
      passed: false,
      status: "rejected",
      failedGate: "visual",
    });
    expect(result.reasons[0]).toBe(
      "expected accepted, got rejected: The visual gate failed",
    );

    const failed = attempt({
      gates: [gate("scope"), gate("safety", false, "adds v-html\nmore")],
    });
    const retried: FixOutcome = { ...accepted, attempts: [failed, attempt()] };
    expect(scoreCase(testCase, report(retried)).gateFailures).toEqual([
      "safety: adds v-html",
    ]);
  });

  it("fails when the fix touches another file or misses a required string", () => {
    const wrong: FixOutcome = {
      ...accepted,
      changes: [
        { path: "app/pages/index.vue", before: "<a>", after: '<a title="x">' },
      ],
    };
    expect(scoreCase(testCase, report(wrong)).reasons).toEqual([
      "changed app/pages/index.vue, which the case does not allow",
      'the fix does not add "aria-label"',
    ]);
  });

  it("fails when the fix adds a forbidden string", () => {
    const hidden: FixOutcome = {
      ...accepted,
      changes: [
        {
          path: FILE,
          before: "<button>",
          after: '<button aria-label="x" aria-hidden="true">',
        },
      ],
    };
    expect(scoreCase(testCase, report(hidden)).reasons).toEqual([
      'the fix adds "aria-hidden=\\"true\\""',
    ]);
  });

  it("only looks at added lines, not at what the file already had", () => {
    const before = '<svg aria-hidden="true" />\n<button>';
    const untouched: FixOutcome = {
      ...accepted,
      changes: [
        {
          path: FILE,
          before,
          after: before.replace("<button>", '<button aria-label="Close">'),
        },
      ],
    };
    expect(scoreCase(testCase, report(untouched)).passed).toBe(true);
  });

  it("checks kept text, forbidden patterns and the review flag", () => {
    const strict: EvalCase = evalCaseSchema.parse({
      ...testCase,
      expect: {
        outcome: "accepted",
        mustKeep: ['class="close"'],
        mustNotMatch: ['aria-label="[^"]*button'],
        flagged: true,
      },
    });
    expect(scoreCase(strict, report(accepted)).reasons).toEqual([
      "the fix was not marked for human review",
    ]);

    const flagged: FixOutcome = {
      ...accepted,
      attempts: [
        attempt({
          gates: [
            gate("scope"),
            { gate: "safety", passed: true, flagged: true, detail: "" },
          ],
        }),
      ],
      changes: [
        {
          path: FILE,
          before: '<button class="close">',
          after: '<span aria-label="Close Button">',
        },
      ],
    };
    const reasons = scoreCase(strict, report(flagged)).reasons;
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain("the fix matches /");
    expect(reasons[1]).toContain("the fix lost");
  });

  it("reports a finding no group covered", () => {
    expect(scoreCase(testCase, report())).toMatchObject({
      passed: false,
      status: "not-attempted",
    });
  });
});

describe("summarize", () => {
  it("computes fix rate, regression rate, cost and refusals", () => {
    const regressed = attempt({
      gates: [
        gate("scope"),
        gate("safety"),
        gate("checks"),
        gate("rescan", false, "The change introduced or exposed new findings"),
      ],
    });
    const refused = attempt({
      stopReason: "refusal",
      gates: [],
      costUsd: 0.01,
    });
    const retried: FixOutcome = {
      ...accepted,
      attempts: [refused, regressed, attempt({ model: "claude-sonnet-5-5" })],
    };
    const runs = [report(retried)];
    const results = [scoreCase(testCase, runs[0] as FixRunReport)];

    expect(summarize([testCase], results, runs)).toEqual({
      cases: 1,
      passed: 1,
      fixRate: 1,
      regressionRate: 0.5,
      costUsd: expect.closeTo(0.21, 6),
      costPerAcceptedFixUsd: expect.closeTo(0.21, 6),
      refusals: 1,
      fallbacks: 1,
    });
  });

  it("uses null where a rate has nothing to divide by", () => {
    expect(summarize([], [], [])).toMatchObject({
      fixRate: null,
      regressionRate: null,
      costPerAcceptedFixUsd: null,
    });
  });
});
