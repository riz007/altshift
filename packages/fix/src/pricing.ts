// USD per million tokens, from the Anthropic pricing page. Note the date whenever this changes.
// Never guess: a missing entry makes the cost meter refuse to run rather than under-count.

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

// Checked on 2026-11-14 against https://platform.claude.com/docs/en/about-claude/pricing
// Cache writes are the 5-minute rate, the only TTL the fix engine uses.
// Claude Haiku 5.5 is priced in two tiers by prompt length, which this table cannot express. It is left
// out on purpose, so a run configured to use it stops instead of under-counting.
export const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-2": {
    inputPerMTok: 8,
    outputPerMTok: 40,
    cacheWritePerMTok: 10,
    cacheReadPerMTok: 0.2,
  },
  "claude-sonnet-5-5": {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheWritePerMTok: 2.5,
    cacheReadPerMTok: 0.1,
  },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export class UnknownPriceError extends Error {
  constructor(readonly model: string) {
    super(`No price for ${model} in packages/fix/src/pricing.ts. Add it from docs.claude.com before running fixes.`);
    this.name = "UnknownPriceError";
  }
}

export function costUsd(model: string, usage: Usage): number {
  const price = PRICES[model];
  if (!price) throw new UnknownPriceError(model);
  const perToken = (perMTok: number) => perMTok / 1_000_000;
  return (
    usage.input_tokens * perToken(price.inputPerMTok) +
    usage.output_tokens * perToken(price.outputPerMTok) +
    (usage.cache_creation_input_tokens ?? 0) * perToken(price.cacheWritePerMTok) +
    (usage.cache_read_input_tokens ?? 0) * perToken(price.cacheReadPerMTok)
  );
}

/** Throws for a model with no price, so a run can stop before it spends anything. */
export function requirePrice(model: string): ModelPrice {
  const price = PRICES[model];
  if (!price) throw new UnknownPriceError(model);
  return price;
}
