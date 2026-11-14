// A small tokenizer for the <template> block of a Vue single-file component.
// It is not a full parser: it only needs tags, attributes, text and comments, and it fails closed
// on anything it cannot read.

export interface TemplateAttribute {
  name: string;
  /** null for a bare attribute such as `disabled`. */
  value: string | null;
}

export interface TemplateTag {
  name: string;
  attributes: TemplateAttribute[];
}

export interface ParsedTemplate {
  tags: TemplateTag[];
  /** Trimmed, non-empty text between tags. */
  texts: string[];
  comments: string[];
}

export type SplitResult = { ok: true; template: string; outside: string } | { ok: false; reason: string };

/** Separate the top-level <template> block from everything else in the file (script, style, custom blocks). */
export function splitSfc(source: string): SplitResult {
  const open = /<template\b([^>]*)>/.exec(source);
  if (!open) return { ok: false, reason: "has no <template> block" };
  if (/\blang\s*=/.test(open[1] ?? "")) return { ok: false, reason: "uses a template language other than HTML" };

  // Slot templates nest, so find the close that matches the first open.
  const start = open.index + open[0].length;
  const marker = /<template\b[^>]*>|<\/template\s*>/g;
  marker.lastIndex = start;
  let depth = 1;
  for (let match = marker.exec(source); match; match = marker.exec(source)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) {
      return {
        ok: true,
        template: source.slice(start, match.index),
        outside: source.slice(0, start) + source.slice(match.index),
      };
    }
  }
  return { ok: false, reason: "has an unclosed <template> block" };
}

export function parseTemplate(source: string): ParsedTemplate | null {
  const parsed: ParsedTemplate = { tags: [], texts: [], comments: [] };
  let text = "";
  const flushText = () => {
    if (text.trim() !== "") parsed.texts.push(text.trim().replace(/\s+/g, " "));
    text = "";
  };

  let i = 0;
  while (i < source.length) {
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end === -1) return null;
      parsed.comments.push(source.slice(i + 4, end));
      i = end + 3;
      continue;
    }
    if (source[i] === "<" && source[i + 1] === "/") {
      const end = source.indexOf(">", i);
      if (end === -1) return null;
      flushText();
      i = end + 1;
      continue;
    }
    const name = source[i] === "<" ? /^[A-Za-z][\w.-]*/.exec(source.slice(i + 1, i + 80))?.[0] : undefined;
    if (name === undefined) {
      text += source[i];
      i++;
      continue;
    }

    flushText();
    i += 1 + name.length;
    const attributes: TemplateAttribute[] = [];
    for (;;) {
      while (i < source.length && /\s/.test(source[i] as string)) i++;
      if (i >= source.length) return null;
      if (source[i] === ">") {
        i++;
        break;
      }
      if (source[i] === "/" && source[i + 1] === ">") {
        i += 2;
        break;
      }

      const nameStart = i;
      while (i < source.length && !/[\s=>]/.test(source[i] as string) && !(source[i] === "/" && source[i + 1] === ">"))
        i++;
      const attributeName = source.slice(nameStart, i);
      if (attributeName === "") return null;

      while (i < source.length && /\s/.test(source[i] as string)) i++;
      if (source[i] !== "=") {
        attributes.push({ name: attributeName, value: null });
        continue;
      }
      i++;
      while (i < source.length && /\s/.test(source[i] as string)) i++;

      const quote = source[i];
      if (quote === '"' || quote === "'") {
        const end = source.indexOf(quote, i + 1);
        if (end === -1) return null;
        attributes.push({ name: attributeName, value: source.slice(i + 1, end) });
        i = end + 1;
      } else {
        const valueStart = i;
        while (i < source.length && !/[\s>]/.test(source[i] as string)) i++;
        attributes.push({ name: attributeName, value: source.slice(valueStart, i) });
      }
    }
    parsed.tags.push({ name, attributes });
  }
  flushText();
  return parsed;
}
