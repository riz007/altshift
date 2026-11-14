import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PathPolicy } from "../src/paths.js";

export interface TestProject {
  root: string;
  policy: PathPolicy;
  remove(): Promise<void>;
}

export const CART = `<template>
  <div class="cart-drawer" role="dialog">
    <button type="button" class="close" @click="open = false">
      <svg aria-hidden="true"><path d="M6 6l12 12" /></svg>
    </button>
  </div>
</template>
`;

/** A throwaway project on disk. Paths in `files` are repo-relative. */
export async function createProject(files: Record<string, string> = {}): Promise<TestProject> {
  const root = await mkdtemp(join(tmpdir(), "altshift-fix-"));
  const all = {
    "app/components/CartDrawer.vue": CART,
    "app/assets/main.css": ":root {\n  --brand: #0b5d4e;\n  --ink: #1f2933;\n}\n",
    "app/components/CartDrawer.test.ts": "test('x', () => {});\n",
    "package.json": '{ "dependencies": { "vue": "3.5.45" } }\n',
    ".env": "SECRET=do-not-read\n",
    "server/api/orders.ts": "export default () => [];\n",
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return {
    root,
    policy: { root, allowPaths: ["app/**"], denyPaths: ["**/*.test.*"] },
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
