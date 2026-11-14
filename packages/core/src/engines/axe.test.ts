import { describe, expect, it } from "vitest";
import { type AxeViolations, fromAxeViolations, wcagCriteria } from "./axe.js";

describe("wcagCriteria", () => {
  it("reads success criteria and skips level and category tags", () => {
    expect(wcagCriteria(["cat.color", "wcag2aa", "wcag143", "wcag1410", "wcag22aa", "wcag111"])).toEqual([
      "1.1.1",
      "1.4.3",
      "1.4.10",
    ]);
  });
});

describe("fromAxeViolations", () => {
  const violation = {
    id: "button-name",
    impact: "critical",
    help: "Buttons must have discernible text",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.14/button-name",
    tags: ["wcag2a", "wcag412"],
    nodes: [
      { html: "<button></button>", impact: "critical", target: [".close"] },
      { html: `<button>${"x".repeat(600)}</button>`, impact: null, target: ["iframe", ["#host", "button"]] },
    ],
  };

  it("emits one finding per failing element", () => {
    const findings = fromAxeViolations([violation] as unknown as AxeViolations);

    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      ruleId: "button-name",
      impact: "critical",
      selector: ".close",
      htmlSnippet: "<button></button>",
      summary: "Buttons must have discernible text",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.14/button-name",
      wcag: ["4.1.2"],
    });
  });

  it("joins frame and shadow-root selectors, clips long snippets and falls back to the rule impact", () => {
    const [, second] = fromAxeViolations([violation] as unknown as AxeViolations);

    expect(second?.selector).toBe("iframe | #host >>> button");
    expect(second?.htmlSnippet).toHaveLength(500);
    expect(second?.impact).toBe("critical");
  });

  it('maps a missing impact to "unknown"', () => {
    const noImpact = { ...violation, impact: null, nodes: [{ html: "<a></a>", impact: null, target: ["a"] }] };
    expect(fromAxeViolations([noImpact] as unknown as AxeViolations)[0]?.impact).toBe("unknown");
  });
});
