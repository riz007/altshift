import type { CommandResult } from "@ariamend/core";
import { describe, expect, it } from "vitest";
import type { FileChange } from "../diff.js";
import type { GateResult } from "../types.js";
import { buildGate, checksGate, runGates, scopeGate, visualGate } from "./index.js";

const policy = { root: "/repo", allowPaths: ["app/**"], denyPaths: ["**/*.test.*"] };
const BEFORE = `<template>
  <button type="button" class="close" @click="close">
    <svg aria-hidden="true"><path d="M6 6l12 12" /></svg>
  </button>
</template>
`;
const change = (after: string, path = "app/components/CartDrawer.vue", before = BEFORE): FileChange => ({
  path,
  before,
  after,
});
const edit = (from: string, to: string) => change(BEFORE.replace(from, to));

describe("scopeGate", () => {
  it("passes a small change inside allowPaths", () => {
    const result = scopeGate([edit('class="close"', 'class="close" aria-label="Close cart"')], policy);
    expect(result).toEqual({ gate: "scope", passed: true, detail: "1 file(s), 2 changed line(s)" });
  });

  it("fails on files outside the policy", () => {
    for (const path of [
      "package.json",
      "server/api.ts",
      ".github/workflows/ci.yml",
      "app/a.test.ts",
      "../x.vue",
      ".env",
    ]) {
      expect(scopeGate([change("x", path, "y")], policy).passed, path).toBe(false);
    }
  });

  it("fails on more than 5 files or more than 150 changed lines", () => {
    const six = Array.from({ length: 6 }, (_, i) => change("b", `app/${i}.vue`, "a"));
    expect(scopeGate(six, policy).detail).toContain("6 files changed");

    const big = change(Array.from({ length: 151 }, (_, i) => `line ${i}`).join("\n"), "app/a.vue", "");
    expect(scopeGate([big], policy).detail).toContain("lines changed");

    const wide = change("x".repeat(25_000), "app/a.vue", "");
    expect(scopeGate([wide], policy).detail).toContain("bytes added");
  });
});

describe("checksGate", () => {
  it("passes when every command exits 0, and says so when none are configured", async () => {
    expect(await checksGate(["true", "echo ok"], process.cwd(), 10)).toMatchObject({
      passed: true,
      detail: "2 command(s) passed",
    });
    expect(await checksGate([], process.cwd(), 10)).toMatchObject({ passed: true, flagged: true });
  });

  it("fails at the first failing command with its output, and skips the rest", async () => {
    const result = await checksGate(["echo 'error TS2322' >&2; exit 2", "echo never-runs"], process.cwd(), 10);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("exited with code 2");
    expect(result.detail).toContain("error TS2322");
    expect(result.detail).not.toContain("never-runs");
  });

  it("fails on a timeout", async () => {
    const result = await checksGate(["sleep 30"], process.cwd(), 1);
    expect(result).toMatchObject({ passed: false, detail: expect.stringContaining("timed out") });
  });
});

describe("visualGate", () => {
  it("passes at or under the threshold", () => {
    expect(visualGate(0.0, 0.02, "button-name")).toEqual({
      gate: "visual",
      passed: true,
      detail: "0.00% of pixels changed",
    });
    expect(visualGate(0.02, 0.02, "button-name").passed).toBe(true);
  });

  it("fails above the threshold", () => {
    expect(visualGate(0.05, 0.02, "button-name")).toMatchObject({
      passed: false,
      detail: expect.stringContaining("5.00%"),
    });
  });

  it("passes with a flag for rules where a visible change is the point", () => {
    expect(visualGate(0.05, 0.02, "color-contrast")).toMatchObject({ passed: true, flagged: true });
  });
});

describe("buildGate", () => {
  const result = (exitCode: number): CommandResult => ({
    command: "pnpm build",
    exitCode,
    timedOut: false,
    output: exitCode ? "Build failed" : "",
  });

  it("keeps everything when the build passes", async () => {
    const outcome = await buildGate({ fixIds: ["a", "b"], build: async () => result(0) });
    expect(outcome).toMatchObject({ kept: ["a", "b"], dropped: [], result: { passed: true, detail: "build passed" } });
  });

  it("drops the newest fixes until the build passes and reports them", async () => {
    const tried: string[][] = [];
    const outcome = await buildGate({
      fixIds: ["a", "b", "c"],
      build: async (ids) => {
        tried.push([...ids]);
        return result(ids.includes("b") ? 1 : 0);
      },
    });

    expect(tried).toEqual([["a", "b", "c"], ["a", "b"], ["a"]]);
    expect(outcome.kept).toEqual(["a"]);
    expect(outcome.dropped).toEqual(["c", "b"]);
    expect(outcome.result).toMatchObject({ passed: true, flagged: true });
  });

  it("fails with nothing kept when no subset builds", async () => {
    const outcome = await buildGate({ fixIds: ["a"], build: async () => result(1) });
    expect(outcome).toMatchObject({ kept: [], dropped: ["a"], result: { passed: false } });
    expect(outcome.result.detail).toContain("Build failed");
  });

  it("does not run a build when there is nothing to build", async () => {
    let ran = false;
    const outcome = await buildGate({
      fixIds: [],
      build: async () => {
        ran = true;
        return result(0);
      },
    });
    expect(ran).toBe(false);
    expect(outcome.result.passed).toBe(true);
  });
});

describe("runGates", () => {
  it("stops at the first failure so later gates never run", async () => {
    const ran: string[] = [];
    const gate = (name: GateResult["gate"], passed: boolean) => () => {
      ran.push(name);
      return { gate: name, passed, detail: "" };
    };

    const run = await runGates([gate("scope", true), gate("safety", false), gate("checks", true)]);

    expect(ran).toEqual(["scope", "safety"]);
    expect(run.passed).toBe(false);
    expect(run.results.map((item) => item.passed)).toEqual([true, false]);
  });

  it("does not report a pass when no gate ran", async () => {
    expect(await runGates([])).toEqual({ passed: false, results: [] });
    expect((await runGates([() => ({ gate: "scope", passed: true, detail: "" })])).passed).toBe(true);
  });
});
