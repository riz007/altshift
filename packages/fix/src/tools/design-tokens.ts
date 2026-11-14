export interface DesignTokens {
  /** CSS custom properties found in the project's styles, e.g. { "--brand": "#0b5d4e" }. */
  cssVariables: Record<string, string>;
}

const MAX_TOKENS = 300;
const MAX_VALUE_LENGTH = 200;
const DECLARATION = /(--[\w-]+)\s*:\s*([^;{}]+);/g;

/** First definition wins. Files are expected in sorted order, so the result is stable. */
export function collectCssVariables(files: ReadonlyArray<{ path: string; content: string }>): DesignTokens {
  const found = new Map<string, string>();
  for (const file of files) {
    if (!/\.(?:css|scss|sass|less|pcss|vue|svelte|astro)$/.test(file.path)) continue;
    for (const match of file.content.matchAll(DECLARATION)) {
      const [, name, value] = match;
      if (name && value && !found.has(name)) found.set(name, value.trim().slice(0, MAX_VALUE_LENGTH));
    }
  }
  const names = [...found.keys()].sort().slice(0, MAX_TOKENS);
  return { cssVariables: Object.fromEntries(names.map((name) => [name, found.get(name) as string])) };
}
