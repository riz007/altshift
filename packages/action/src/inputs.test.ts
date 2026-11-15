import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { inputVariable, isSafeEvent, parseInputs, readInput } from "./inputs.js";

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

describe("readInput", () => {
  it("reads the underscore name action.yml sets, trimmed, and empty when unset", () => {
    const env = { INPUT_ANTHROPIC_API_KEY: " sk-test ", "INPUT_GITHUB-TOKEN": "ignored" };
    expect(readInput("anthropic-api-key", env)).toBe("sk-test");
    expect(readInput("github-token", env)).toBe("");
    expect(inputVariable("budget-usd")).toBe("INPUT_BUDGET_USD");
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

  it("passes every input through under a name every shell keeps", async () => {
    const action = await readFile(new URL("../../../action.yml", import.meta.url), "utf8");
    const declared = [...action.matchAll(/^ {2}([a-z][a-z-]*):\n {4}description:/gm)].map(
      (match) => match[1] as string,
    );
    const inputs = declared.filter(
      (name) =>
        !["fixes-accepted", "fixes-rejected", "fixes-suggested", "cost-usd", "pr-url", "evidence-path"].includes(
          name,
        ) && name !== "working-directory",
    );
    expect(inputs.sort()).toEqual([
      "anthropic-api-key",
      "budget-usd",
      "config",
      "github-token",
      "license-key",
      "max-fixes",
      "mode",
    ]);
    for (const name of inputs) {
      expect(action, name).toContain(`${inputVariable(name)}: \${{ inputs.${name} }}`);
    }
    const variables = [...action.matchAll(/^ {8}(INPUT_[^:]+):/gm)].map((match) => match[1] as string);
    expect(variables.length).toBe(inputs.length);
    for (const variable of variables) expect(variable, variable).toMatch(/^[A-Z_][A-Z0-9_]*$/);
  });
});
