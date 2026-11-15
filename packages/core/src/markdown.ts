// Escaping for text that goes into Markdown: pull request bodies and the evidence pack.

/**
 * Make page-derived text safe to place inside Markdown prose.
 * Strips HTML comments, breaks @mentions and escapes Markdown control characters.
 */
export function escapeUntrusted(text: string, maxLength = 300): string {
  const cleaned = text
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    // Escaped first, so an entity such as &#64; cannot turn back into an @mention or a tag.
    .replace(/&/g, "&amp;")
    .replace(/@(?=[\w-])/g, "@​")
    .replace(/[\\`*_{}[\]()#+!|<>~]/g, "\\$&")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/**
 * Wrap page-derived text in an inline code span that cannot be broken out of.
 * In a table cell a pipe would end the cell even inside code, so pass `inTable` there.
 */
export function inlineCode(text: string, maxLength = 200, inTable = false): string {
  const singleLine = text
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const clipped = singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 1)}…` : singleLine;
  const longestRun = Math.max(0, ...(clipped.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const body = inTable ? clipped.replace(/\|/g, "\\|") : clipped;
  return `${fence} ${body} ${fence}`;
}
