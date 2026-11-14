import { isAbsolute, relative, sep } from "node:path";
import type { Page } from "playwright";
import type { SourceHint } from "./types.js";

const MAX_HINTS = 3;
// The component that rendered the element is the best guess. Each ancestor is a weaker one.
const CONFIDENCE = [0.9, 0.6, 0.4];

/**
 * In dev builds Vue 3 sets `el.__vueParentComponent`, and the Vite plugin sets `type.__file` to an absolute path.
 * Verified on Nuxt 4.6 with Vue 3.5. Components from packages (NuxtLink, RouterView) have no project file and are skipped.
 */
export async function readVueComponentFiles(page: Page, selector: string): Promise<string[]> {
  try {
    return await page.evaluate((query) => {
      interface Instance {
        type?: { __file?: unknown };
        parent?: Instance | null;
      }
      const element = document.querySelector(query) as (Element & { __vueParentComponent?: Instance }) | null;
      const files: string[] = [];
      let hops = 0;
      for (
        let instance = element?.__vueParentComponent;
        instance && hops < 50;
        instance = instance.parent ?? undefined, hops++
      ) {
        const file = instance.type?.__file;
        if (typeof file === "string" && !files.includes(file)) files.push(file);
      }
      return files;
    }, selector);
  } catch {
    // Selectors that cross frames or shadow roots are not valid for querySelector.
    return [];
  }
}

/** Page-reported paths are untrusted: keep only files inside the repo and outside node_modules. */
export function toSourceHints(files: readonly string[], repoRoot: string): SourceHint[] {
  const hints: SourceHint[] = [];
  for (const file of files) {
    // A path is all a hint may carry. Anything longer or stranger could be text aimed at the model.
    if (!isAbsolute(file) || file.length > 300 || !/^[\w@./ ()[\]\\:-]+$/.test(file)) continue;
    const path = relative(repoRoot, file);
    if (path === "" || path.startsWith("..") || isAbsolute(path)) continue;
    const segments = path.split(sep);
    if (segments.includes("node_modules") || segments.some((segment) => segment.startsWith("."))) continue;
    hints.push({
      file: segments.join("/"),
      origin: "vue-component-file",
      confidence: CONFIDENCE[hints.length] ?? 0.4,
    });
    if (hints.length === MAX_HINTS) break;
  }
  return hints;
}
