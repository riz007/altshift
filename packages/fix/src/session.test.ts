import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CART, createProject, type TestProject } from "../test/project.js";
import { EditSession } from "./session.js";

const FILE = "app/components/CartDrawer.vue";
const OLD = '<button type="button" class="close"';
const NEW = '<button type="button" class="close" aria-label="Close cart"';

let project: TestProject;
let session: EditSession;
beforeEach(async () => {
  project = await createProject({ "app/big.vue": "x".repeat(201 * 1024) });
  session = new EditSession(project.policy);
});
afterEach(() => project.remove());

describe("EditSession", () => {
  it("stages an edit in memory and leaves the file on disk alone", async () => {
    const result = await session.propose({ path: FILE, oldString: OLD, newString: NEW, rationale: "name the button" });

    expect(result.ok).toBe(true);
    expect(await readFile(join(project.root, FILE), "utf8")).toBe(CART);
    expect(session.changes()).toEqual([{ path: FILE, before: CART, after: CART.replace(OLD, NEW) }]);
  });

  it("lets later reads and edits see earlier staged edits", async () => {
    await session.propose({ path: FILE, oldString: OLD, newString: NEW, rationale: "r" });
    const read = await session.read(FILE);
    expect(read.ok && read.content).toContain('aria-label="Close cart"');

    const second = await session.propose({
      path: FILE,
      oldString: 'role="dialog"',
      newString: 'role="dialog" aria-modal="true"',
      rationale: "r",
    });
    expect(second.ok).toBe(true);
    expect(session.changes()[0]?.after).toContain('aria-modal="true"');
    expect(session.changes()[0]?.after).toContain('aria-label="Close cart"');
  });

  it("rejects an edit whose oldString is missing, repeated, empty or unchanged", async () => {
    const edit = (oldString: string, newString = "x") =>
      session.propose({ path: FILE, oldString, newString, rationale: "r" });

    expect(await edit("<nope>")).toMatchObject({ ok: false, reason: expect.stringContaining("not found") });
    expect(await edit("<")).toMatchObject({ ok: false, reason: expect.stringContaining("more than once") });
    expect(await edit("")).toMatchObject({ ok: false });
    expect(await edit(OLD, OLD)).toMatchObject({ ok: false });
    expect(session.edits).toEqual([]);
  });

  it("refuses files outside the policy and files over 200 KB", async () => {
    expect(await session.read(".env")).toMatchObject({ ok: false });
    expect(await session.read("../../etc/passwd")).toMatchObject({ ok: false });
    expect(await session.read("app/big.vue")).toEqual({ ok: false, reason: "file is larger than 200 KB" });
    expect(
      await session.propose({ path: "package.json", oldString: "vue", newString: "evil", rationale: "r" }),
    ).toMatchObject({ ok: false });
  });

  it("reports no change when an edit is undone", async () => {
    await session.propose({ path: FILE, oldString: OLD, newString: NEW, rationale: "r" });
    await session.propose({ path: FILE, oldString: NEW, newString: OLD, rationale: "r" });
    expect(session.changes()).toEqual([]);
  });
});
