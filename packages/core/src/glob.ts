// A small glob matcher for allowPaths and denyPaths. Supports **, *, ? and one level of {a,b}.
// Paths are repo-relative with forward slashes. Dotfiles match like any other name.

const cache = new Map<string, RegExp>();
const CACHE_LIMIT = 500;

function bracesAreSimple(glob: string): boolean {
  let depth = 0;
  for (const char of glob) {
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth < 0 || depth > 1) return false;
  }
  return depth === 0;
}

function toRegExp(input: string, ignoreCase: boolean): RegExp {
  // Repeated wildcards mean the same thing and only add backtracking.
  const glob = input
    .replace(/^\.\//, "")
    .replace(/(?:\*\*\/)+/g, "**/")
    .replace(/\*{3,}/g, "**");
  const braces = bracesAreSimple(glob);

  let source = "";
  let inBraces = false;
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          source += "(?:[^/]+/)*";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (braces && char === "{") {
      inBraces = true;
      source += "(?:";
    } else if (braces && char === "}") {
      inBraces = false;
      source += ")";
    } else if (inBraces && char === ",") {
      source += "|";
    } else {
      source += char.replace(/[\\^$+.()|[\]{}]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, ignoreCase ? "i" : "");
}

export interface GlobOptions {
  ignoreCase?: boolean;
}

export function matchesGlob(path: string, glob: string, options: GlobOptions = {}): boolean {
  const key = `${options.ignoreCase ? "i" : "s"}:${glob}`;
  let pattern = cache.get(key);
  if (pattern === undefined) {
    pattern = toRegExp(glob, options.ignoreCase ?? false);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, pattern);
  }
  return pattern.test(path);
}

export function matchesAny(path: string, globs: readonly string[], options: GlobOptions = {}): boolean {
  return globs.some((glob) => matchesGlob(path, glob, options));
}

/**
 * For globs that come from the model. Many wildcards or brace groups can make matching
 * exponentially slow, and nothing a model needs to ask for looks like that.
 */
export function isSimpleGlob(glob: string): boolean {
  const wildcards = glob.replace(/\*+/g, "*").match(/[*?]/g)?.length ?? 0;
  const groups = glob.match(/\{/g)?.length ?? 0;
  return wildcards <= 8 && groups <= 2 && bracesAreSimple(glob);
}
