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
    expect(() => costUsd("claude-unknown-9", { input_tokens: 1, output_tokens: 1 })).toThrow(UnknownPriceError);
    // Haiku 5.5 has two price tiers by prompt length, which the table cannot express, so it has no entry.
    expect(() => costUsd("claude-haiku-5-5", { input_tokens: 1, output_tokens: 1 })).toThrow(UnknownPriceError);
  });

  it("prices input, output, cache writes and cache reads separately", () => {
    const usage = {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_creation_input_tokens: 200_000,
      cache_read_input_tokens: 500_000,
    };
    // 8 + 4 + 2 + 0.1
    expect(costUsd("claude-fable-5-2", usage)).toBeCloseTo(14.1, 6);
    // 2 + 1 + 0.5 + 0.05
    expect(costUsd("claude-sonnet-5-5", usage)).toBeCloseTo(3.55, 6);
  });
});
