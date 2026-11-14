import { readFile } from "node:fs/promises";
import type { FileChange } from "./diff.js";
import { MAX_FILE_BYTES, type PathPolicy, resolveAllowedFile } from "./paths.js";
import type { StagedEdit } from "./types.js";

export type ReadResult = { ok: true; path: string; content: string } | { ok: false; reason: string };

/**
 * One fix attempt's view of the repo. Edits are staged in memory, never written,
 * and later reads see them, so a second edit to the same file builds on the first.
 */
export class EditSession {
  readonly edits: StagedEdit[] = [];
  private readonly originals = new Map<string, string>();
  private readonly staged = new Map<string, string>();

  constructor(readonly policy: PathPolicy) {}

  async read(input: string): Promise<ReadResult> {
    const file = await resolveAllowedFile(this.policy, input);
    if (!file.ok) return file;
    const staged = this.staged.get(file.path);
    if (staged !== undefined) return { ok: true, path: file.path, content: staged };
    if (file.size > MAX_FILE_BYTES) return { ok: false, reason: "file is larger than 200 KB" };

    try {
      return { ok: true, path: file.path, content: await readFile(file.absolute, "utf8") };
    } catch {
      return { ok: false, reason: "file could not be read" };
    }
  }

  async propose(edit: StagedEdit): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
    if (edit.oldString === "") return { ok: false, reason: "oldString is empty" };
    if (edit.oldString === edit.newString) return { ok: false, reason: "oldString and newString are the same" };

    const file = await this.read(edit.path);
    if (!file.ok) return file;

    const first = file.content.indexOf(edit.oldString);
    if (first === -1)
      return { ok: false, reason: "oldString was not found in the file. Read the file and copy it exactly" };
    if (file.content.indexOf(edit.oldString, first + 1) !== -1) {
      return {
        ok: false,
        reason: "oldString matches more than once. Include more surrounding lines to make it unique",
      };
    }

    const next = file.content.slice(0, first) + edit.newString + file.content.slice(first + edit.oldString.length);
    if (!this.originals.has(file.path)) this.originals.set(file.path, file.content);
    this.staged.set(file.path, next);
    this.edits.push({ ...edit, path: file.path });
    return { ok: true, path: file.path };
  }

  /** Net change per file, sorted by path. Files edited back to their original content are left out. */
  changes(): FileChange[] {
    return [...this.staged]
      .map(([path, after]) => ({ path, before: this.originals.get(path) ?? "", after }))
      .filter((change) => change.before !== change.after)
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  }
}
