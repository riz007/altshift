import { type Finding, HONESTY, type ScanReport } from "altshift";
import { describe, expect, it } from "vitest";
import { formatScanReport } from "./format.js";

const finding: Omit<Finding, "ruleId" | "selector" | "summary"> = {
  fingerprint: "f".repeat(64),
  engine: "axe",
  impact: "critical",
  target: "/",
  checkpoint: "load",
  url: "http://localhost:3000/",
  normalizedSelector: ".wishlist",
  htmlSnippet: "<button></button>",
  helpUrl: "https://example.test",
  wcag: ["4.1.2"],
};

const report: ScanReport = {
  schemaVersion: 1,
  fingerprintVersion: 1,
  engine: { id: "axe", version: "4.14.0" },
  scanned: [
    { target: "/", checkpoint: "load", url: "http://localhost:3000/" },
    { target: "/shipping", checkpoint: "load", url: "http://localhost:3000/shipping" },
  ],
  findings: [
    { ...finding, ruleId: "button-name", selector: ".wishlist", summary: "Buttons must have discernible text" },
    { ...finding, ruleId: "color-contrast", selector: ".badge", summary: "Elements must meet contrast" },
    { ...finding, ruleId: "some-new-rule", selector: "\u001b[2Jdiv", summary: "Unknown\u0007 rule" },
  ],
  failures: [{ target: "/cart", message: "/cart returned HTTP 500" }],
};

describe("formatScanReport", () => {
  const text = formatScanReport(report);

  it("lists findings under their checkpoint with the fix tier", () => {
    expect(text).toContain("/  (load)");
    expect(text).toMatch(/critical\s+button-name\s+auto\s+\.wishlist/);
    expect(text).toMatch(/critical\s+color-contrast\s+suggest\s+\.badge/);
  });

  it("shows clean checkpoints and targets that could not be scanned", () => {
    expect(text).toMatch(/\/shipping {2}\(load\)\n {2}no findings/);
    expect(text).toContain("/cart: /cart returned HTTP 500");
  });

  it("counts by tier, with unknown rules as report", () => {
    expect(text).toContain("3 finding(s): 1 auto, 0 auto-review, 1 suggest, 1 report");
  });

  it("applies tier overrides from config", () => {
    expect(formatScanReport(report, { "button-name": "report" })).toContain(
      "0 auto, 0 auto-review, 1 suggest, 2 report",
    );
  });

  it("strips control characters that came from the page", () => {
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u0007");
  });

  it("carries the honesty statement and no compliance claim", () => {
    expect(text).toContain(HONESTY.scan);
    expect(text).not.toMatch(/compliant|accessible\b/i);
  });
});
