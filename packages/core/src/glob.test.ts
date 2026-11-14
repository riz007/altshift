import { describe, expect, it } from "vitest";
import { isSimpleGlob, matchesAny, matchesGlob } from "./glob.js";

describe("matchesGlob", () => {
  it.each([
    ["app/**", "app/components/Cart.vue", true],
    ["app/**", "app/x.vue", true],
    ["app/**", "application/x.vue", false],
    ["app/**", "lib/app/x.vue", false],
    ["**/*.test.*", "app/a/b/Cart.test.ts", true],
    ["**/*.test.*", "Cart.test.ts", true],
    ["**/*.test.*", "app/Cart.ts", false],
    ["components/*.vue", "components/Cart.vue", true],
    ["components/*.vue", "components/cart/Line.vue", false],
    ["**/.env*", ".env.local", true],
    ["**/.env*", "apps/web/.env", true],
    ["src/**/*.{ts,vue}", "src/a/b.vue", true],
    ["src/**/*.{ts,vue}", "src/a/b.css", false],
    ["file?.ts", "file1.ts", true],
    ["file?.ts", "file12.ts", false],
    ["./journeys/*.ts", "journeys/a.ts", true],
    ["a+b/(c).ts", "a+b/(c).ts", true],
    ["a.ts", "abts", false],
  ])("%s vs %s -> %s", (glob, path, expected) => {
    expect(matchesGlob(path, glob)).toBe(expected);
  });

  it("treats unbalanced or nested braces as literal text instead of throwing", () => {
    expect(matchesGlob("a.ts", "{")).toBe(false);
    expect(matchesGlob("{", "{")).toBe(true);
    expect(matchesGlob("a", "{a,{b,c}}")).toBe(false);
  });

  it("collapses repeated wildcards, so a hostile glob cannot stall matching", () => {
    const started = Date.now();
    const glob = `${"**/".repeat(70)}x`;
    expect(matchesGlob(`${"a/".repeat(40)}y`, glob)).toBe(false);
    expect(matchesGlob("a/b/x", glob)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("can ignore case", () => {
    expect(matchesGlob("app/PACKAGE.JSON", "**/package.json")).toBe(false);
    expect(matchesGlob("app/PACKAGE.JSON", "**/package.json", { ignoreCase: true })).toBe(true);
  });

  it("isSimpleGlob rejects globs with many wildcards or brace groups", () => {
    expect(isSimpleGlob("app/components/**/*.{vue,ts}")).toBe(true);
    expect(isSimpleGlob("{*,*}".repeat(10))).toBe(false);
    expect(isSimpleGlob("*/".repeat(12))).toBe(false);
    expect(isSimpleGlob("{a,{b,c}}")).toBe(false);
  });

  it("matchesAny is false for an empty list", () => {
    expect(matchesAny("app/x.vue", [])).toBe(false);
    expect(matchesAny("app/x.vue", ["pages/**", "app/**"])).toBe(true);
  });
});
