import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExitCode } from "altshift";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./run.js";

let dir: string;
let out: string;
let err: string;
const io = () => ({
  cwd: dir,
  stdout: (text: string) => {
    out += text;
  },
  stderr: (text: string) => {
    err += text;
  },
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "altshift-cli-"));
  out = "";
  err = "";
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("altshift", () => {
  it("prints usage for --help", async () => {
    expect(await main(["--help"], io())).toBe(ExitCode.Completed);
    expect(out).toContain("altshift scan");
  });

  it("exits 2 with usage when no command or an unknown one is given", async () => {
    expect(await main([], io())).toBe(ExitCode.Failure);
    expect(await main(["baseline"], io())).toBe(ExitCode.Failure);
    expect(err).toContain("Unknown command: baseline");
  });

  it("exits 2 on an unknown flag instead of throwing", async () => {
    expect(await main(["scan", "--base-url", "http://x.test"], io())).toBe(ExitCode.Failure);
    expect(err).toContain("--base-url");
  });

  it("says plainly what is not available yet", async () => {
    expect(await main(["init"], io())).toBe(ExitCode.Failure);
    expect(err).toContain("not available yet");

    expect(await main(["fix"], io())).toBe(ExitCode.Failure);
    expect(err).toContain("only supports --dry-run");
  });

  it("fix exits 2 without an API key, before starting anything", async () => {
    expect(await main(["fix", "--dry-run"], io())).toBe(ExitCode.Failure);
    expect(err).toContain("ANTHROPIC_API_KEY is not set");
  });

  it("scan exits 2 when there is no config", async () => {
    expect(await main(["scan"], io())).toBe(ExitCode.Failure);
    expect(err).toContain("No altshift.config.ts");
  });

  it("scan exits 2 when the config has no dev server", async () => {
    await writeFile(join(dir, "altshift.config.mjs"), "export default {};");

    expect(await main(["scan"], io())).toBe(ExitCode.Failure);
    expect(err).toContain("app.dev is required");
  });

  it("scan exits 2 when the dev command fails, without starting a browser", async () => {
    await writeFile(
      join(dir, "altshift.config.mjs"),
      'export default { app: { dev: { command: "exit 7", url: "http://127.0.0.1:9/", readyTimeoutSeconds: 5 } } };',
    );

    expect(await main(["scan"], io())).toBe(ExitCode.Failure);
    expect(err).toContain("exited with code 7");
    expect(out).toBe("");
  });
});
