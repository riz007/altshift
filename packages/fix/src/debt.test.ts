import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, ok } from "@ariamend/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelClient } from "./agent.js";
import { type DeliveryPort, runDebt } from "./debt.js";

let repo: string;
let project: string;
const neverCalled: ModelClient = async () => {
  throw new Error("the model must not be called");
};

function port(existing: DeliveryPort["existing"]) {
  const delivered: unknown[] = [];
  const value: DeliveryPort = {
    existing,
    deliver: async (input) => {
      delivered.push(input);
      return ok({ action: "created", url: "https://github.test/pull/1" });
    },
  };
  return { port: value, delivered };
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "ariamend-debt-"));
  project = join(repo, "shop");
  await mkdir(project);
  await writeFile(join(project, "package.json"), JSON.stringify({ dependencies: { nuxt: "4.6.4" } }));
});
afterEach(() => rm(repo, { recursive: true, force: true }));

const config = (command: string) =>
  writeFile(
    join(project, "ariamend.config.mjs"),
    `export default { app: { framework: "nuxt", dev: { command: ${JSON.stringify(command)}, url: "http://127.0.0.1:9/", readyTimeoutSeconds: 5 } } };`,
  );

describe("runDebt", () => {
  it("stops before starting anything when the open pull requests cannot be read", async () => {
    await config("touch started && sleep 30");
    const { port: github, delivered } = port(async () => fail("delivery", "Could not read pull requests: 401"));

    const result = await runDebt({
      cwd: project,
      repoRoot: repo,
      checkedOut: "0".repeat(40),
      client: neverCalled,
      port: github,
    });

    expect(!result.ok && result.error.message).toContain("401");
    expect(delivered).toEqual([]);
    await expect(access(join(project, "started"))).rejects.toThrow();
  });

  it("delivers nothing when the dev server does not start", async () => {
    await config("echo boom >&2; exit 4");
    const { port: github, delivered } = port(async () => ok(undefined));

    const result = await runDebt({
      cwd: project,
      repoRoot: repo,
      checkedOut: "0".repeat(40),
      client: neverCalled,
      port: github,
    });

    expect(!result.ok && result.error.code).toBe("dev-server");
    expect(delivered).toEqual([]);
  });

  it("refuses a project that is not inside the repository", async () => {
    await config("exit 1");
    const elsewhere = await mkdtemp(join(tmpdir(), "ariamend-other-"));
    const { port: github } = port(async () => ok(undefined));
    try {
      const result = await runDebt({
        cwd: project,
        repoRoot: elsewhere,
        checkedOut: "0".repeat(40),
        client: neverCalled,
        port: github,
      });
      expect(!result.ok && result.error.message).toContain("is not inside the repository");
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});
