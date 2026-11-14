import { createContext, Script } from "node:vm";

const BUDGET_MS = 2000;
const MAX_PATTERN_LENGTH = 300;

// The pattern comes from the model, so it may backtrack forever. Running the match in a vm context
// lets V8 interrupt it: a plain RegExp call cannot be timed out.
const MATCH = new Script(`(() => {
  const re = new RegExp(pattern);
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i);
  return hits;
})()`);

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export type SearchResult = { ok: true; hits: SearchHit[]; truncated: boolean } | { ok: false; reason: string };

export function searchFiles(
  pattern: string,
  files: ReadonlyArray<{ path: string; content: string }>,
  maxHits: number,
): SearchResult {
  if (pattern.length > MAX_PATTERN_LENGTH) return { ok: false, reason: "pattern is too long" };
  try {
    new RegExp(pattern);
  } catch (error) {
    return { ok: false, reason: `invalid regular expression: ${(error as Error).message}` };
  }

  const hits: SearchHit[] = [];
  const deadline = Date.now() + BUDGET_MS;
  for (const file of files) {
    const lines = file.content.split("\n");
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, reason: "search took too long. Use a simpler pattern or a narrower glob" };

    let matched: number[];
    try {
      matched = Array.from(MATCH.runInContext(createContext({ pattern, lines }), { timeout: remaining }) as number[]);
    } catch {
      return { ok: false, reason: "search took too long. Use a simpler pattern or a narrower glob" };
    }
    for (const index of matched) {
      if (hits.length === maxHits) return { ok: true, hits, truncated: true };
      hits.push({ path: file.path, line: index + 1, text: (lines[index] as string).trim().slice(0, 300) });
    }
  }
  return { ok: true, hits, truncated: false };
}
