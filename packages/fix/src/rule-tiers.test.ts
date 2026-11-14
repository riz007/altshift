import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, resolveModels } from "./models.js";
import { costUsd, UnknownPriceError } from "./pricing.js";
import { tierFor } from "./rule-tiers.js";

describe("tierFor", () => {
  it("never auto-fixes a rule it does not know", () => {
    expect(tierFor("some-future-rule")).toBe("report");
  });

  it("marks alt text as needing review", () => {
    expect(tierFor("image-alt")).toBe("auto-review");
  });

  it("only proposes fixes that live outside the template", () => {
    for (const rule of ["html-has-lang", "html-lang-valid", "document-title"]) {
      expect(tierFor(rule), rule).toBe("suggest");
    }
  });

  it("lets config override a default", () => {
    expect(tierFor("color-contrast", { "color-contrast": "report" })).toBe("report");
  });
});

describe("resolveModels", () => {
  it("uses Fable 5.2 for fixes by default", () => {
    expect(resolveModels({}, {}).fix).toBe(DEFAULT_MODELS.fix);
  });

  it("lets env override config", () => {
    const models = resolveModels({ fix: "from-config" }, { ALTSHIFT_MODEL_FIX: "from-env" });
    expect(models.fix).toBe("from-env");
  });
});

describe("costUsd", () => {
  it("refuses to price a model with no entry", () => {
    expect(() => costUsd("claude-fable-5-2", { input_tokens: 1, output_tokens: 1 })).toThrow(UnknownPriceError);
  });
});
