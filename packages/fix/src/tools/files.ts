import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { checkPath, type PathPolicy } from "../paths.js";

const MAX_WALK = 20_000;

/** Every file the policy allows, repo-relative and sorted. Symlinks, dotfiles and node_modules are not followed. */
export async function listAllowedFiles(policy: PathPolicy): Promise<string[]> {
  const files: string[] = [];
  const pending = [""];
  while (pending.length > 0 && files.length < MAX_WALK) {
    const dir = pending.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(join(policy.root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && checkPath(policy, path).ok) files.push(path);
    }
  }
  return files.sort();
}
