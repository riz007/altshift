import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isSafeEvent, parseInputs } from "./inputs.js";

const from = (values: Record<string, string>) => (name: string) => values[name] ?? "";
const keys = { "anthropic-api-key": "sk-test", "github-token": "ghs_test" };

describe("parseInputs", () => {
  it("fills defaults", () => {
    const parsed = parseInputs(from(keys));
    expect(parsed.success && parsed.data).toEqual({
      mode: "debt",
      config: "ariamend.config.ts",
      anthropicApiKey: "sk-test",
      githubToken: "ghs_test",
      maxFixes: undefined,
      budgetUsd: undefined,
    });
  });

  it("reads numbers from strings", () => {
    const parsed = parseInputs(from({ ...keys, "max-fixes": "3", "budget-usd": "1.5" }));
    expect(parsed.success && parsed.data).toMatchObject({ maxFixes: 3, budgetUsd: 1.5 });
  });

  it.each([
    [{ "github-token": "x" }, "anthropic-api-key is required"],
    [{ "anthropic-api-key": "x" }, "github-token is required"],
    [{ ...keys, mode: "check" }, "mode"],
    [{ ...keys, "max-fixes": "many" }, "maxFixes"],
    [{ ...keys, "max-fixes": "0" }, "maxFixes"],
    [{ ...keys, "budget-usd": "-1" }, "budgetUsd"],
    [{ ...keys, "budget-usd": "1000" }, "budgetUsd"],
  ])("rejects %j", (values, expected) => {
    const parsed = parseInputs(from(values));
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain(expected);
  });
});

describe("isSafeEvent", () => {
  it("allows only events that run code already on the default branch", () => {
    for (const event of ["schedule", "workflow_dispatch", "push"]) expect(isSafeEvent(event), event).toBe(true);
    for (const event of ["pull_request", "pull_request_target", "issue_comment", "workflow_run", ""]) {
      expect(isSafeEvent(event), event).toBe(false);
    }
  });
});

describe("action.yml", () => {
  it("runs the project's installed ariamend, never a downloaded one", async () => {
    const action = await readFile(new URL("../../../action.yml", import.meta.url), "utf8");
    expect(action).toContain("run: node_modules/.bin/ariamend action");
    expect(action).toContain("run: node_modules/.bin/ariamend install-browser --with-deps");
    expect(action).not.toMatch(/\bnpx\b|npm install|npm exec/);
  });

  it("passes every input through, because composite actions do not", async () => {
    const action = await readFile(new URL("../../../action.yml", import.meta.url), "utf8");
    for (const name of ["mode", "config", "anthropic-api-key", "github-token", "max-fixes", "budget-usd"]) {
      expect(action, name).toContain(`INPUT_${name.toUpperCase()}: \${{ inputs.${name} }}`);
    }
  });
});
