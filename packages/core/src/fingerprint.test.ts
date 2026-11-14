import { describe, expect, it } from "vitest";
import { type FingerprintInput, fingerprint } from "./fingerprint.js";

const base: FingerprintInput = {
  engine: "axe",
  ruleId: "button-name",
  target: "/cart",
  checkpoint: "load",
  normalizedSelector: ".cart-drawer > button",
};

describe("fingerprint", () => {
  it("is a stable SHA-256 of the versioned input", () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base }));
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
    // Pinned on purpose: a change here is a breaking change and needs a FINGERPRINT_VERSION bump.
    expect(fingerprint(base)).toBe("07339433b0cab977d810e110eca66b4513f4fc4966a8ac9c41eeb91433edf721");
  });

  it.each(["engine", "ruleId", "target", "checkpoint", "normalizedSelector"] as const)("changes with %s", (field) => {
    const changed = { ...base, [field]: field === "engine" ? "accesslint" : `${base[field]}x` };
    expect(fingerprint(changed)).not.toBe(fingerprint(base));
  });
});
