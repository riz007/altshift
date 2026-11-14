import { describe, expect, it } from "vitest";
import type { RawFinding } from "./engines/types.js";
import { sortFindings, toFinding } from "./scan.js";

const raw: RawFinding = {
  ruleId: "button-name",
  impact: "critical",
  selector: ".close[data-v-7ba5bd90]",
  htmlSnippet: "<button></button>",
  summary: "Buttons must have discernible text",
  helpUrl: "https://example.test/button-name",
  wcag: ["4.1.2"],
};
const where = { engine: "axe", target: "cart-open", checkpoint: "drawer", url: "http://localhost:3000/" } as const;

describe("toFinding", () => {
  it("keeps the reported selector and fingerprints the normalized one", () => {
    const finding = toFinding(raw, where);

    expect(finding.selector).toBe(".close[data-v-7ba5bd90]");
    expect(finding.normalizedSelector).toBe(".close");
    expect(finding.fingerprint).toBe(toFinding({ ...raw, selector: ".close[data-v-00000000]" }, where).fingerprint);
  });

  it("does not let the URL or page content into the fingerprint", () => {
    const moved = toFinding({ ...raw, htmlSnippet: "<button>different</button>" }, { ...where, url: "http://x.test/" });
    expect(moved.fingerprint).toBe(toFinding(raw, where).fingerprint);
  });

  it("separates the same element at different checkpoints", () => {
    expect(toFinding(raw, { ...where, checkpoint: "other" }).fingerprint).not.toBe(toFinding(raw, where).fingerprint);
  });
});

describe("sortFindings", () => {
  it("orders by target, checkpoint, rule, then selector, whatever the input order", () => {
    const a = toFinding(raw, { ...where, target: "/" });
    const b = toFinding({ ...raw, ruleId: "aria-dialog-name" }, where);
    const c = toFinding(raw, where);
    const d = toFinding({ ...raw, selector: ".open" }, where);

    const expected = [a, b, c, d].map((finding) => finding.fingerprint);
    expect(sortFindings([d, c, b, a]).map((finding) => finding.fingerprint)).toEqual(expected);
    expect(sortFindings([b, d, a, c]).map((finding) => finding.fingerprint)).toEqual(expected);
  });
});
