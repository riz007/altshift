import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { type PathPolicy, resolveAllowedFile } from "./paths.js";
import type { StagedEdit } from "./types.js";

interface AppliedFix {
  id: string;
  edits: StagedEdit[];
}

/**
 * Applies fixes to the working tree and can take any of them back out.
 * Files are always rebuilt from their original content plus the active fixes, in order,
 * so reverting one fix never disturbs another that touched the same file.
 */
export class Workspace {
  private readonly originals = new Map<string, { absolute: string; content: string }>();
  private fixes: AppliedFix[] = [];

  constructor(private readonly policy: PathPolicy) {}

  get activeIds(): string[] {
    return this.fixes.map((fix) => fix.id);
  }

  /** Returns false, and changes nothing, when the edits do not apply on top of the active fixes. */
  async apply(id: string, edits: readonly StagedEdit[]): Promise<boolean> {
    const candidate = [...this.fixes.filter((fix) => fix.id !== id), { id, edits: [...edits] }];
    return this.write(candidate);
  }

  async revert(id: string): Promise<void> {
    await this.write(this.fixes.filter((fix) => fix.id !== id));
  }

  /** Keep exactly these fixes. Unknown ids are ignored. */
  async keepOnly(ids: readonly string[]): Promise<void> {
    await this.write(this.fixes.filter((fix) => ids.includes(fix.id)));
  }

  /**
   * Put every touched file back the way it was found. One file that cannot be restored does not
   * stop the others: all are attempted, then the failures are reported together.
   */
  async restore(): Promise<void> {
    const failures: string[] = [];
    for (const [path, original] of this.originals) {
      try {
        const current = await readFile(original.absolute, "utf8").catch(() => undefined);
        if (current !== original.content) await this.overwrite(path, original.absolute, original.content);
      } catch (error) {
        failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.fixes = [];
    if (failures.length > 0)
      throw new Error(`Could not restore every file. Check these by hand:\n${failures.join("\n")}`);
  }

  /**
   * The content of every file the active fixes change, built from the originals in memory.
   * This is what gets delivered: never whatever happens to be on disk.
   */
  async contents(): Promise<Array<{ path: string; content: string }>> {
    const built = (await this.build(this.fixes)) ?? new Map<string, string>();
    return [...built]
      .filter(([path, content]) => content !== this.originals.get(path)?.content)
      .map(([path, content]) => ({ path, content }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  private async build(fixes: AppliedFix[]): Promise<Map<string, string> | undefined> {
    const contents = new Map<string, string>();
    for (const fix of fixes) {
      for (const edit of fix.edits) {
        const current = contents.get(edit.path) ?? (await this.original(edit.path));
        if (current === undefined) return undefined;
        const at = current.indexOf(edit.oldString);
        if (at === -1 || current.indexOf(edit.oldString, at + 1) !== -1) return undefined;
        contents.set(edit.path, current.slice(0, at) + edit.newString + current.slice(at + edit.oldString.length));
      }
    }
    return contents;
  }

  private async write(fixes: AppliedFix[]): Promise<boolean> {
    const contents = await this.build(fixes);
    if (contents === undefined) return false;

    for (const [path, original] of this.originals) {
      const wanted = contents.get(path) ?? original.content;
      if ((await readFile(original.absolute, "utf8")) !== wanted) await this.overwrite(path, original.absolute, wanted);
    }
    this.fixes = fixes;
    return true;
  }

  // Project commands run between writes. If one of them swapped the file for a link, stop:
  // writing through it could land anywhere.
  private async overwrite(path: string, absolute: string, content: string): Promise<void> {
    const file = await resolveAllowedFile(this.policy, path);
    if (!file.ok || file.absolute !== absolute) {
      throw new Error(`Refusing to write ${path}: it no longer points at the file that was read.`);
    }
    const handle = await open(absolute, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
  }

  private async original(path: string): Promise<string | undefined> {
    const known = this.originals.get(path);
    if (known !== undefined) return known.content;
    const file = await resolveAllowedFile(this.policy, path);
    if (!file.ok) return undefined;
    const content = await readFile(file.absolute, "utf8");
    this.originals.set(path, { absolute: file.absolute, content });
    return content;
  }
}
