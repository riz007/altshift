import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { detectFromPackageJson } from "./detect.js";
import type { FrameworkAdapter } from "./types.js";
import { readVueComponentFiles, toSourceHints } from "./vue-hints.js";

const PROMPT_NOTES = `This is a Nuxt project with Vue single-file components.

- Components, composables and Vue APIs are auto-imported. Never add import statements.
- Internal navigation uses <NuxtLink to="...">. Keep it. Do not replace it with <a>.
- aria-label on <NuxtLink> lands on its <a>. For any other component, read its template first: attributes reach
  the single root element, or wherever the template has v-bind="$attrs". If that is not the control, edit the
  component's own template.
- Edit only the <template> block. If the fix needs new script (a new ref, useId(), a handler), call give_up
  and say what a person should add.
- Bind state with ":" to a value the template already uses: :aria-checked="giftWrap". For aria-* a bound false
  renders "false", which is what you want.
- A new binding can read a value, choose between two strings, call $t() with a key, or use a template string
  whose placeholders read values: :aria-label="\`Save \${product.name} to wishlist\`".
- Use $t() only with a key that already exists: search the locale files. If a new key is needed, call give_up
  with the key and the text.
- Do not assume a visually-hidden or sr-only class exists. Search the project CSS first.
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
