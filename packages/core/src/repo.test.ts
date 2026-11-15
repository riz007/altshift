import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRepoRoot, readCheckout } from "./repo.js";

const run = promisify(execFile);
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ariamend-repo-"));
  const git = (...args: string[]) => run("git", args, { cwd: dir });
  await git("init", "-q");
  await git("config", "user.email", "test@example.test");
  await git("config", "user.name", "Test");
  await git("config", "commit.gpgsign", "false");
  await writeFile(join(dir, ".gitignore"), ".ariamend/\n");
  await writeFile(join(dir, "a.vue"), "<template />\n");
  await git("add", ".");
  await git("commit", "-q", "-m", "init");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("readCheckout", () => {
  it("reports the commit and a clean tree, ignoring ignored files", async () => {
    await mkdir(join(dir, ".ariamend"));
    await writeFile(join(dir, ".ariamend", "evidence.md"), "x");

    const checkout = await readCheckout(dir);

    expect(checkout.head).toMatch(/^[0-9a-f]{40}$/);
    expect(checkout.changed).toEqual([]);
  });

  it("lists changed and new files", async () => {
    await writeFile(join(dir, "a.vue"), "<template><b /></template>\n");
    await writeFile(join(dir, "new.vue"), "<template />\n");

    expect((await readCheckout(dir)).changed).toEqual(["a.vue", "new.vue"]);
  });

  it("finds the repository root from a folder inside it", async () => {
    await mkdir(join(dir, "shop", "app"), { recursive: true });
    expect(await findRepoRoot(join(dir, "shop", "app"))).toBe(dir);
  });
});
