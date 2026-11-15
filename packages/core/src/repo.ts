import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The nearest folder at or above `start` that holds a `.git` entry, or undefined outside a checkout. */
export async function findRepoRoot(start: string): Promise<string | undefined> {
  for (let dir = start; ; dir = dirname(dir)) {
    try {
      await access(join(dir, ".git"));
      return dir;
    } catch {
      if (dirname(dir) === dir) return undefined;
    }
  }
}

export interface Checkout {
  /** The commit checked out. */
  head: string;
  /** Tracked or untracked files that differ from it. Ignored files are left out. */
  changed: string[];
}

/** What is checked out at `repoRoot`, read with git itself. */
export async function readCheckout(repoRoot: string): Promise<Checkout> {
  const git = (...args: string[]) => run("git", args, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
  const head = (await git("rev-parse", "HEAD")).stdout.trim();
  const status = (await git("status", "--porcelain", "--untracked-files=normal")).stdout;
  const changed = status
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3))
    .sort();
  return { head, changed };
}
