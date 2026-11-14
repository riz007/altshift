import type { FrameworkId } from "./types.js";

// Order matters: meta-frameworks before the libraries they are built on.
const SIGNATURES: ReadonlyArray<readonly [FrameworkId, string]> = [
  ["nuxt", "nuxt"],
  ["next", "next"],
  ["sveltekit", "@sveltejs/kit"],
  ["astro", "astro"],
  ["react-router", "@shopify/hydrogen"],
  ["react-router", "react-router"],
  ["angular", "@angular/core"],
  ["vite", "vite"],
];

export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Pure detection from package.json. File-based checks belong in each adapter's detect(). */
export function detectFromPackageJson(pkg: PackageJsonLike): { framework: FrameworkId; evidence: string } | null {
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  for (const [framework, name] of SIGNATURES) {
    const version = deps[name];
    if (version !== undefined) {
      return { framework, evidence: `${name}@${version} in package.json` };
    }
  }
  return null;
}
