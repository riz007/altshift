/** Hidden marker used to find and update our single PR comment. */
export const COMMENT_MARKER = "<!-- altshift:comment -->";

/**
 * Make page-derived text safe to place inside Markdown prose.
 * Strips HTML comments, breaks @mentions and escapes Markdown control characters.
 */
export function escapeUntrusted(text: string, maxLength = 300): string {
  const cleaned = text
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(/@(?=[\w-])/g, "@​")
    .replace(/[\\`*_{}[\]()#+!|<>~]/g, "\\$&")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/** Wrap page-derived text in an inline code span that cannot be broken out of. */
export function inlineCode(text: string, maxLength = 200): string {
  const singleLine = text
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const clipped = singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 1)}…` : singleLine;
  const longestRun = Math.max(0, ...(clipped.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  return `${fence} ${clipped} ${fence}`;
}
