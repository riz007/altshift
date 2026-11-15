import { describe, expect, it } from "vitest";
import { redactSecrets, runCommand, scrubbedEnv } from "./command.js";

describe("runCommand", () => {
  it("reports the exit code and the output tail", async () => {
    const ok = await runCommand("echo fine", process.cwd(), 10);
    expect(ok).toMatchObject({ exitCode: 0, timedOut: false, output: "fine" });

    const bad = await runCommand("echo 'TS2322: nope' >&2; exit 2", process.cwd(), 10);
    expect(bad).toMatchObject({ exitCode: 2, timedOut: false });
    expect(bad.output).toContain("TS2322");
  });

  it("stops a command that runs past its timeout", async () => {
    const started = Date.now();
    const result = await runCommand("sleep 30", process.cwd(), 1);

    expect(result).toMatchObject({ exitCode: null, timedOut: true });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("does not pass API keys or tokens to the command", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-0000000000";
    try {
      const result = await runCommand('echo "key=[$ANTHROPIC_API_KEY]"', process.cwd(), 10);
      expect(result.output).toBe("key=[]");
    } finally {
      process.env.ANTHROPIC_API_KEY = "";
    }
  });
});

describe("scrubbedEnv", () => {
  it("drops secrets and keeps the rest", () => {
    const env = scrubbedEnv({
      PATH: "/bin",
      NODE_ENV: "development",
      ANTHROPIC_API_KEY: "a",
      ARIAMEND_LICENSE_KEY: "b",
      GITHUB_TOKEN: "c",
      "INPUT_ANTHROPIC-API-KEY": "d",
    });
    expect(env).toEqual({ PATH: "/bin", NODE_ENV: "development" });
  });

  it("withholds the files GitHub Actions reads back, and matches names in any case", () => {
    const env = scrubbedEnv({
      GITHUB_ENV: "/tmp/env",
      GITHUB_PATH: "/tmp/path",
      GITHUB_OUTPUT: "/tmp/out",
      GH_ENTERPRISE_TOKEN: "x",
      anthropic_api_key: "y",
      GITHUB_SHA: "abc",
      NPM_TOKEN: "kept-for-the-project",
    });
    expect(env).toEqual({ GITHUB_SHA: "abc", NPM_TOKEN: "kept-for-the-project" });
  });
});

describe("redactSecrets", () => {
  it("removes secret values from text", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-test-0000000000", PATH: "/usr/local/bin" };
    expect(redactSecrets("failed with sk-ant-test-0000000000 in /usr/local/bin", env)).toBe(
      "failed with [redacted] in /usr/local/bin",
    );
  });

  it("redacts the project's own secrets and well-known token shapes", () => {
    const env = { NPM_TOKEN: "npm_abcdefgh12345678", DATABASE_URL: "x" };
    expect(redactSecrets("401 for npm_abcdefgh12345678", env)).toBe("401 for [redacted]");
    expect(redactSecrets("key sk-ant-api03-AbCdEf123456 leaked", {})).toBe("key [redacted] leaked");
    expect(redactSecrets("token ghp_abcdefghijklmnopqrstuvwxyz012345", {})).toBe("token [redacted]");
    expect(redactSecrets("postgres://admin:hunter2@db.internal/shop", {})).toBe(
      "postgres://[redacted]@db.internal/shop",
    );
  });
});
