/**
 * Make untrusted text safe to print on one line: page content, model output and command output can
 * carry control characters, bidi overrides or newlines that rewrite a terminal or forge CI log commands.
 */
export function printable(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ");
}
