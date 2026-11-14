import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { detectFromPackageJson } from "./detect.js";
import type { FrameworkAdapter } from "./types.js";
import { readVueComponentFiles, toSourceHints } from "./vue-hints.js";

const PROMPT_NOTES = `This is a Nuxt project with Vue single-file components.

- Components, composables and Vue APIs (ref, computed, useId) are auto-imported. Do not add import statements for them.
- Internal navigation uses <NuxtLink to="...">. Keep it. Do not replace it with <a>.
- aria-label on <NuxtLink> lands on its <a>. For any other component, read its template first: attributes reach
  a single root element only, and not at all with inheritAttrs: false or several roots. If the root is not the
  control, edit the component itself.
- Only the <template> block can be changed. Edits to <script> or <style> are rejected. If the fix needs new
  script (a new ref, useId(), a handler), call give_up and say what a person should add.
- State attributes (aria-checked, aria-expanded, aria-pressed, aria-selected) must be bound to existing state,
  never a fixed value: :aria-checked="giftWrap". For aria-* a bound false renders "false", which is what you want.
- New bindings may only read a value, choose between two strings, or call $t(). No method calls.
- Do not change the accessible name with state on a toggle that has aria-pressed.
- Do not assume a visually-hidden or sr-only class exists. Search the project CSS first. Otherwise use aria-label.
- User-facing strings: if the file already uses $t(), add the new string the same way. Otherwise write it inline.
- Keep the file's existing formatting, quote style and attribute order.`;

export const nuxtAdapter: FrameworkAdapter = {
  id: "nuxt",
  displayName: "Nuxt",
  defaults: {
    devCommand: "nuxt dev",
    buildCommand: "nuxt build",
    url: "http://localhost:3000",
    sourceGlobs: ["app/**", "components/**", "pages/**", "layouts/**"],
    templateExtensions: [".vue"],
  },
  promptNotes: PROMPT_NOTES,

  async detect(repoRoot) {
    let pkg: unknown;
    try {
      pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    } catch {
      return null;
    }
    if (typeof pkg !== "object" || pkg === null) return null;
    const detected = detectFromPackageJson(pkg);
    if (detected?.framework !== "nuxt") return null;
    return { framework: "nuxt", confidence: "high", evidence: [detected.evidence] };
  },

  async collectSourceHints(page, selector, repoRoot) {
    return toSourceHints(await readVueComponentFiles(page, selector), repoRoot);
  },
};
