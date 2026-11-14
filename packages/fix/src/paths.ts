import { realpath, stat } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";
import { matchesAny } from "altshift";

export interface PathPolicy {
  /** Absolute path of the project root. */
  root: string;
  allowPaths: readonly string[];
  denyPaths: readonly string[];
}

export const MAX_FILE_BYTES = 200 * 1024;

// Never readable or editable by the model, whatever the config allows:
// manifests, lockfiles, config files, dependencies, and every dotfile or dot directory (.env, .github, .git).
const PROTECTED = [
  "**/package.json",
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/pnpm-lock.yaml",
  "**/pnpm-workspace.yaml",
  "**/yarn.lock",
  "**/bun.lock",
  "**/bun.lockb",
  "**/*.config.*",
  "**/tsconfig*.json",
  "**/jsconfig*.json",
  "**/node_modules/**",
  "**/.*",
  "**/.*/**",
];

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };
export type FileCheck = { ok: true; path: string; absolute: string; size: number } | { ok: false; reason: string };

/** Lexical check only. Use resolveAllowedFile before touching the disk. */
export function checkPath(policy: PathPolicy, input: string): PathCheck {
  if (input === "" || input.includes("\0")) return { ok: false, reason: "empty or invalid path" };
  if (input.includes("\\")) return { ok: false, reason: "use forward slashes" };
  if (input.startsWith("/") || /^[a-zA-Z]:/.test(input)) return { ok: false, reason: "absolute paths are not allowed" };

  const path = posix.normalize(input);
  if (path === "." || path === ".." || path.startsWith("../")) {
    return { ok: false, reason: "path is outside the project" };
  }
  // Protection and deny rules ignore case: on macOS and Windows, PACKAGE.JSON is package.json.
  if (matchesAny(path, PROTECTED, { ignoreCase: true })) return { ok: false, reason: "protected file" };
  if (!matchesAny(path, policy.allowPaths)) return { ok: false, reason: "outside fix.allowPaths" };
  // "src/legacy" and "src/legacy/" deny the folder's contents too.
  const deny = policy.denyPaths.flatMap((glob) => [glob, `${glob.replace(/\/+$/, "")}/**`]);
  if (matchesAny(path, deny, { ignoreCase: true })) return { ok: false, reason: "matches fix.denyPaths" };
  return { ok: true, path };
}

/**
 * Resolve a model-supplied path to a real file. The file's real location is checked too,
 * so a symlink inside an allowed folder cannot reach a file outside the policy.
 * The returned path is the real one, so two spellings of one file share a single identity.
 */
export async function resolveAllowedFile(policy: PathPolicy, input: string): Promise<FileCheck> {
  const lexical = checkPath(policy, input);
  if (!lexical.ok) return lexical;

  let realRoot: string;
  let absolute: string;
  try {
    realRoot = await realpath(policy.root);
    absolute = await realpath(resolve(realRoot, lexical.path));
  } catch {
    return { ok: false, reason: "file not found" };
  }

  const realRelative = relative(realRoot, absolute).split(sep).join("/");
  const real = checkPath(policy, realRelative);
  if (!real.ok) return { ok: false, reason: `resolves to a file that is not allowed (${real.reason})` };

  try {
    const info = await stat(absolute);
    if (!info.isFile()) return { ok: false, reason: "not a file" };
    return { ok: true, path: real.path, absolute, size: info.size };
  } catch {
    return { ok: false, reason: "file not found" };
  }
}
