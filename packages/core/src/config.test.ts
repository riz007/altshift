import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.js";

describe("resolveConfig", () => {
  it("fills every default from an empty config", () => {
    const config = resolveConfig({});

    expect(config.app.framework).toBe("auto");
    expect(config.targets.pages).toEqual(["/"]);
    expect(config.targets.journeys).toBeUndefined();
    expect(config.scan.engine).toBe("axe");
    expect(config.scan.tags).toContain("wcag22aa");
    expect(config.fix.maxFixesPerRun).toBe(10);
    expect(config.fix.maxAttemptsPerFinding).toBe(2);
  });

  it("rejects unknown keys so typos surface early", () => {
    expect(() => resolveConfig({ target: { pages: ["/"] } })).toThrow();
  });

  it("rejects the v0.2 fields that were removed", () => {
    expect(() => resolveConfig({ minImpact: "serious" })).toThrow();
    expect(() => resolveConfig({ fix: { delivery: "pr" } })).toThrow();
    expect(() => resolveConfig({ fix: { maxFindingsPerRun: 5 } })).toThrow();
  });

  it("accepts only paths as page targets, never another origin", () => {
    expect(() => resolveConfig({ targets: { pages: ["https://shop.example/cart"] } })).toThrow();
    expect(() => resolveConfig({ targets: { pages: ["//shop.example/cart"] } })).toThrow();
    expect(() => resolveConfig({ targets: { pages: ["cart"] } })).toThrow();
    expect(resolveConfig({ targets: { pages: ["/cart?step=2"] } }).targets.pages).toEqual(["/cart?step=2"]);
  });

  it("rejects a dev URL that is not http or https", () => {
    expect(() => resolveConfig({ app: { dev: { command: "pnpm dev", url: "file:///etc/passwd" } } })).toThrow();
  });

  it("rejects an unknown scan engine", () => {
    expect(() => resolveConfig({ scan: { engine: "lighthouse" } })).toThrow();
  });

  it("rejects an unknown fix tier", () => {
    expect(() => resolveConfig({ fix: { ruleTiers: { "image-alt": "yolo" } } })).toThrow();
  });

  it("caps attempts per finding at 3", () => {
    expect(() => resolveConfig({ fix: { maxAttemptsPerFinding: 10 } })).toThrow();
  });
});
