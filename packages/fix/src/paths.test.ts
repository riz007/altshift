import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, type TestProject } from "../test/project.js";
import { checkPath, resolveAllowedFile } from "./paths.js";

let project: TestProject;
beforeEach(async () => {
  project = await createProject();
});
afterEach(() => project.remove());

describe("checkPath", () => {
  it("accepts a file inside allowPaths and normalizes it", () => {
    expect(checkPath(project.policy, "app/components/CartDrawer.vue")).toEqual({
      ok: true,
      path: "app/components/CartDrawer.vue",
    });
    expect(checkPath(project.policy, "./app/components/../components/CartDrawer.vue")).toEqual({
      ok: true,
      path: "app/components/CartDrawer.vue",
    });
  });

  it.each([
    ["../outside.vue", "outside the project"],
    ["app/../../outside.vue", "outside the project"],
    ["/etc/passwd", "absolute"],
    ["C:\\Windows\\system.ini", "forward slashes"],
    ["app\\components\\CartDrawer.vue", "forward slashes"],
    ["app/a\0.vue", "invalid"],
    ["", "invalid"],
    ["server/api/orders.ts", "allowPaths"],
    ["app/components/CartDrawer.test.ts", "denyPaths"],
  ])("rejects %j", (input, reason) => {
    const result = checkPath(project.policy, input);
    expect(!result.ok && result.reason).toContain(reason);
  });

  it("protects manifests, lockfiles, config and dotfiles even when config allows everything", () => {
    const open = { root: project.root, allowPaths: ["**"], denyPaths: [] };
    for (const path of [
      "package.json",
      "apps/web/package.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "nuxt.config.ts",
      "app/tailwind.config.js",
      "tsconfig.json",
      ".env",
      "app/.env.local",
      ".github/workflows/ci.yml",
      ".git/config",
      ".npmrc",
      "node_modules/vue/index.js",
      "app/node_modules/x/index.js",
    ]) {
      expect(checkPath(open, path), path).toEqual({ ok: false, reason: "protected file" });
    }
    expect(checkPath(open, "server/api/orders.ts").ok).toBe(true);
  });

  it("ignores case for protected files and deny rules", () => {
    const open = { root: project.root, allowPaths: ["**"], denyPaths: ["**/*.test.*", "src/legacy"] };
    expect(checkPath(open, "app/PACKAGE.JSON").ok).toBe(false);
    expect(checkPath(open, "app/Nuxt.Config.TS").ok).toBe(false);
    expect(checkPath(open, "app/Cart.Test.ts").ok).toBe(false);
    expect(checkPath(open, "src/legacy/old.vue")).toEqual({ ok: false, reason: "matches fix.denyPaths" });
    expect(checkPath(open, "src/legacy-new/a.vue").ok).toBe(true);
  });
});

describe("resolveAllowedFile", () => {
  it("resolves an allowed file and reports its size", async () => {
    const file = await resolveAllowedFile(project.policy, "app/components/CartDrawer.vue");
    expect(file.ok && file.path).toBe("app/components/CartDrawer.vue");
    expect(file.ok && file.size).toBeGreaterThan(0);
  });

  it("rejects a missing file and a directory", async () => {
    const missing = await resolveAllowedFile(project.policy, "app/components/Nope.vue");
    expect(!missing.ok && missing.reason).toBe("file not found");

    const dir = await resolveAllowedFile(project.policy, "app/components");
    expect(!dir.ok && dir.reason).toBe("not a file");
  });

  it("rejects a symlink in an allowed folder that points at a protected or outside file", async () => {
    await symlink(join(project.root, ".env"), join(project.root, "app/components/Env.vue"));
    await symlink(join(project.root, "server/api/orders.ts"), join(project.root, "app/components/Orders.vue"));
    const outside = join(project.root, "..", `outside-${Date.now()}.txt`);
    await writeFile(outside, "outside");
    await symlink(outside, join(project.root, "app/components/Outside.vue"));

    for (const name of ["Env.vue", "Orders.vue", "Outside.vue"]) {
      const result = await resolveAllowedFile(project.policy, `app/components/${name}`);
      expect(!result.ok && result.reason, name).toContain("not allowed");
    }
  });
});
