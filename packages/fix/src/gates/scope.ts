import { type FileChange, lineDiff } from "../diff.js";
import { checkPath, type PathPolicy } from "../paths.js";
import type { GateResult } from "../types.js";

export const MAX_FILES_PER_GROUP = 5;
export const MAX_CHANGED_LINES_PER_GROUP = 150;
// Long lines would let a huge change through the line limit.
export const MAX_ADDED_BYTES_PER_GROUP = 20_000;

/** Only allowed files are touched, and the change stays small enough to review. */
export function scopeGate(changes: readonly FileChange[], policy: PathPolicy): GateResult {
  const problems: string[] = [];

  for (const change of changes) {
    const allowed = checkPath(policy, change.path);
    if (!allowed.ok) problems.push(`${change.path}: ${allowed.reason}`);
  }
  if (changes.length > MAX_FILES_PER_GROUP) {
    problems.push(`${changes.length} files changed. The limit is ${MAX_FILES_PER_GROUP}`);
  }
  let changedLines = 0;
  let addedBytes = 0;
  for (const change of changes) {
    const diff = lineDiff(change.before, change.after);
    changedLines += diff.added.length + diff.removed.length;
    addedBytes += Buffer.byteLength(diff.added.join("\n"));
  }
  if (changedLines > MAX_CHANGED_LINES_PER_GROUP) {
    problems.push(`${changedLines} lines changed. The limit is ${MAX_CHANGED_LINES_PER_GROUP}`);
  }
  if (addedBytes > MAX_ADDED_BYTES_PER_GROUP) {
    problems.push(`${addedBytes} bytes added. The limit is ${MAX_ADDED_BYTES_PER_GROUP}`);
  }

  if (problems.length > 0) return { gate: "scope", passed: false, detail: problems.join("\n") };
  return { gate: "scope", passed: true, detail: `${changes.length} file(s), ${changedLines} changed line(s)` };
}
