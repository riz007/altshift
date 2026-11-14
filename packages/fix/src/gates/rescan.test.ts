import type { Finding } from "altshift";
import { describe, expect, it } from "vitest";
import { type RescanInput, rescanGate } from "./rescan.js";

function finding(selector: string, ruleId = "button-name"): Finding {
  return {
    fingerprint: `${ruleId}:${selector}`,
    ruleId,
    engine: "axe",
    impact: "critical",
    target: "/",
    checkpoint: "load",
    url: "",
    selector,
    normalizedSelector: selector,
    htmlSnippet: "",
    summary: "",
    helpUrl: "",
    wcag: [],
  };
}
const scan = (...findings: Finding[]): RescanInput => ({
  findings,
  scanned: [{ target: "/", checkpoint: "load", url: "" }],
  failures: [],
});

const close = finding(".close");
const label = finding("input", "label");
const card1 = finding("article:nth-child(1) > .wishlist");
const card2 = finding("article:nth-child(2) > .wishlist");

describe("rescanGate", () => {
  it("passes when the finding is gone and nothing new appeared", () => {
    expect(rescanGate([close], scan(close, label), scan(label))).toEqual({
      gate: "rescan",
      passed: true,
      detail: "1 of 1 finding(s) cleared",
    });
  });

  it("passes a grouped fix that cleared some, and says how many remain", () => {
    expect(rescanGate([card1, card2], scan(card1, card2), scan(card2))).toMatchObject({
      passed: true,
      detail: "1 of 2 finding(s) cleared, 1 still reported",
    });
  });

  it("fails when the finding is still there", () => {
    expect(rescanGate([close], scan(close, label), scan(close, label))).toMatchObject({
      passed: false,
      detail: "1 of 1 finding(s) are still reported",
    });
  });

  it("fails when the fix traded one finding for another rule", () => {
    const result = rescanGate([close], scan(close), scan(finding(".close", "aria-required-attr")));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("aria-required-attr");
    expect(result.detail).toContain("without undoing the original fix");
  });

  it("fails when the same rule now fails on a different kind of element", () => {
    expect(rescanGate([close], scan(close), scan(finding(".open"))).passed).toBe(false);
  });

  it("fails when another rule's findings were swapped, even though the totals match", () => {
    const promo = finding(".promo__link", "link-name");
    const result = rescanGate(
      [promo],
      scan(promo, card1, card2),
      scan(finding(".cart > button"), finding(".nav > button")),
    );
    expect(result.passed).toBe(false);
  });

  it("tolerates untouched findings whose position shifted", () => {
    const shifted = finding("article:nth-child(3) > .wishlist");
    expect(rescanGate([close], scan(close, card2), scan(shifted)).passed).toBe(true);
  });

  it("counts a partial fix correctly when the survivor's position shifted", () => {
    const survivor = finding("article:nth-child(3) > .wishlist");
    expect(rescanGate([card1, card2], scan(card1, card2), scan(survivor))).toMatchObject({
      passed: true,
      detail: "1 of 2 finding(s) cleared, 1 still reported",
    });
  });

  it("fails when the page could not be scanned after the change", () => {
    const broken: RescanInput = {
      findings: [],
      scanned: [],
      failures: [{ target: "/", message: "/ returned HTTP 500" }],
    };
    const result = rescanGate([close], scan(close), broken);
    expect(result).toMatchObject({ passed: false, detail: expect.stringContaining("HTTP 500") });
  });

  it("fails when the after scan never reached the checkpoint", () => {
    const elsewhere: RescanInput = {
      findings: [],
      scanned: [{ target: "/other", checkpoint: "load", url: "" }],
      failures: [],
    };
    expect(rescanGate([close], scan(close), elsewhere).detail).toContain("did not reach /");
  });

  it("fails when the finding was never in the before scan", () => {
    expect(rescanGate([close], scan(label), scan(label)).passed).toBe(false);
  });
});
