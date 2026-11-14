import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CART, createProject, type TestProject } from "../test/project.js";
import type { StagedEdit } from "./types.js";
import { Workspace } from "./workspace.js";

const FILE = "app/components/CartDrawer.vue";
const label: StagedEdit = {
  path: FILE,
  oldString: 'class="close"',
  newString: 'class="close" aria-label="Close cart"',
  rationale: "r",
};
const modal: StagedEdit = {
  path: FILE,
  oldString: 'role="dialog"',
  newString: 'role="dialog" aria-modal="true"',
  rationale: "r",
};

let project: TestProject;
let workspace: Workspace;
const onDisk = () => readFile(join(project.root, FILE), "utf8");

beforeEach(async () => {
  project = await createProject();
  workspace = new Workspace(project.policy);
});
afterEach(() => project.remove());

describe("Workspace", () => {
  it("writes a fix to disk and restores the original", async () => {
    expect(await workspace.apply("a", [label])).toBe(true);
    expect(await onDisk()).toContain('aria-label="Close cart"');

    await workspace.restore();
    expect(await onDisk()).toBe(CART);
    expect(workspace.activeIds).toEqual([]);
  });

  it("reverts one fix without disturbing another in the same file", async () => {
    await workspace.apply("a", [label]);
    await workspace.apply("b", [modal]);

    await workspace.revert("a");

    const content = await onDisk();
    expect(content).not.toContain("aria-label");
    expect(content).toContain('aria-modal="true"');
    expect(workspace.activeIds).toEqual(["b"]);
  });

  it("keepOnly leaves exactly the named fixes", async () => {
    await workspace.apply("a", [label]);
    await workspace.apply("b", [modal]);

    await workspace.keepOnly(["a"]);

    expect(await onDisk()).toBe(CART.replace(label.oldString, label.newString));
  });

  it("refuses edits that do not apply, and changes nothing", async () => {
    await workspace.apply("a", [label]);
    const stale: StagedEdit = { path: FILE, oldString: "<nope>", newString: "x", rationale: "r" };

    expect(await workspace.apply("b", [stale])).toBe(false);
    expect(workspace.activeIds).toEqual(["a"]);
    expect(await onDisk()).toBe(CART.replace(label.oldString, label.newString));
  });

  it("never writes outside the policy", async () => {
    const evil: StagedEdit = { path: "package.json", oldString: "vue", newString: "evil", rationale: "r" };
    expect(await workspace.apply("a", [evil])).toBe(false);
    expect(await readFile(join(project.root, "package.json"), "utf8")).toContain('"vue"');

    expect(await workspace.apply("b", [{ ...evil, path: "../outside.txt" }])).toBe(false);
  });

  it("replaces a fix when the same id is applied again", async () => {
    await workspace.apply("a", [label]);
    await workspace.apply("a", [modal]);

    expect(await onDisk()).toBe(CART.replace(modal.oldString, modal.newString));
  });
});
