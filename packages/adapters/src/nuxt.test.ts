import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adapterFor, detectAdapter } from "./index.js";
import { nuxtAdapter } from "./nuxt.js";
import { toSourceHints } from "./vue-hints.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ariamend-adapter-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("nuxtAdapter.detect", () => {
  it("recognises a Nuxt project from package.json", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { nuxt: "4.6.4", vue: "3.5.45" } }));

    expect(await nuxtAdapter.detect(dir)).toEqual({
      framework: "nuxt",
      confidence: "high",
      evidence: ["nuxt@4.6.4 in package.json"],
    });
    expect((await detectAdapter(dir))?.id).toBe("nuxt");
  });

  it("returns null for another framework, a missing package.json or broken JSON", async () => {
    expect(await nuxtAdapter.detect(dir)).toBeNull();

    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
    expect(await nuxtAdapter.detect(dir)).toBeNull();
    expect(await detectAdapter(dir)).toBeUndefined();

    await writeFile(join(dir, "package.json"), "{ not json");
    expect(await nuxtAdapter.detect(dir)).toBeNull();
  });

  it("keeps prompt notes under 25 lines", () => {
    expect(nuxtAdapter.promptNotes.split("\n").length).toBeLessThan(25);
    expect(adapterFor("nuxt")).toBe(nuxtAdapter);
    expect(adapterFor("next")).toBeUndefined();
  });
});

describe("toSourceHints", () => {
  const root = "/repo/shop";

  it("makes paths repo-relative and ranks the nearest component first", () => {
    expect(toSourceHints([`${root}/app/components/Cart.vue`, `${root}/app/pages/index.vue`], root)).toEqual([
      { file: "app/components/Cart.vue", origin: "vue-component-file", confidence: 0.9 },
      { file: "app/pages/index.vue", origin: "vue-component-file", confidence: 0.6 },
    ]);
  });

  it("drops anything outside the repo, in node_modules or in a dot directory", () => {
    const files = [
      "/etc/passwd",
      "/repo/other/app/Cart.vue",
      `${root}/../secrets/Cart.vue`,
      `${root}/node_modules/nuxt/dist/app/components/nuxt-link.js`,
      `${root}/.nuxt/components.d.ts`,
      "relative/Cart.vue",
      `${root}/app/layouts/default.vue`,
    ];
    expect(toSourceHints(files, root).map((hint) => hint.file)).toEqual(["app/layouts/default.vue"]);
  });

  it("returns at most three hints", () => {
    const files = ["a", "b", "c", "d"].map((name) => `${root}/app/${name}.vue`);
    expect(toSourceHints(files, root)).toHaveLength(3);
  });
});
