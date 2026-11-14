// Changing anything here changes fingerprints. Bump FINGERPRINT_VERSION in fingerprint.ts with it.

// One alternation so "#" and "." inside attribute values are never mistaken for IDs or classes.
const TOKEN = /\[(?:[^\]"']|"[^"]*"|'[^']*')*\]|([#.])((?:\\.|[\w-])+)/g;

const SCOPE_ATTR = /^\[data-(?:v-[0-9a-f]{8}|astro-cid-[a-z0-9]+)(?:="")?\]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// React useId across versions: ":r1:", "«r1»", "_r_1_".
const REACT_USE_ID = /:[a-zA-Z0-9]+:|«[a-zA-Z0-9]+»|_r_[a-z0-9]+_/g;
const HASHED_CLASS = /^(css|sc|jsx|svelte|astro|emotion)-[A-Za-z0-9]{4,}$/;

function looksHashed(text: string): boolean {
  return /\d/.test(text) || (/[a-z]/.test(text) && /[A-Z]/.test(text));
}

function generalizeId(id: string): string {
  if (UUID.test(id)) return "*";
  return id
    .replace(REACT_USE_ID, "*")
    .replace(/^v-\d+(?:-\d+)*$/, "v-*")
    .replace(/[-_]\d{3,}$/, "-*")
    .replace(/[-_]([0-9a-f]{8,})$/i, (match, hex: string) => (/\d/.test(hex) ? "-*" : match));
}

function generalizeClass(name: string): string {
  // Webpack-style CSS modules: Button_root__a1B2c. BEM (card__title) has no hash and is left alone.
  const cssModule = /^(.+?)__([A-Za-z0-9_]{5,})$/.exec(name);
  if (cssModule?.[1] && cssModule[2] && looksHashed(cssModule[2])) return cssModule[1];

  // Vite CSS modules: _title_1x2y3_7.
  const viteModule = /^_(.+)_[a-z0-9]{5,}_\d+$/.exec(name);
  if (viteModule?.[1]) return `_${viteModule[1]}`;

  const hashed = HASHED_CLASS.exec(name);
  if (hashed?.[1]) return `${hashed[1]}-*`;

  return name;
}

/**
 * Remove the parts of a selector that change between builds or page loads.
 * Uses only the selector: never the URL or page text.
 */
export function normalizeSelector(selector: string): string {
  return selector
    .replace(TOKEN, (token: string, sigil: string | undefined, escaped: string | undefined) => {
      if (sigil === undefined || escaped === undefined) return SCOPE_ATTR.test(token) ? "" : token;
      const name = escaped.replace(/\\(.)/g, "$1");
      const generalized = sigil === "#" ? generalizeId(name) : generalizeClass(name);
      return generalized === name ? token : `${sigil}${generalized}`;
    })
    .replace(/\s+/g, " ")
    .trim();
}
