// USD per million tokens. Fill from docs.claude.com before M5 and note the date checked.
// Never guess: a missing entry makes the cost meter refuse to run rather than under-count.

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

// Checked on: (not yet)
export const PRICES: Record<string, ModelPrice> = {};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export class UnknownPriceError extends Error {
  constructor(readonly model: string) {
    super(
      `No price for ${model} in packages/fix/src/pricing.ts. Add it from docs.claude.com before running fixes.`,
    );
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
    (usage.cache_creation_input_tokens ?? 0) *
      perToken(price.cacheWritePerMTok) +
    (usage.cache_read_input_tokens ?? 0) * perToken(price.cacheReadPerMTok)
  );
}
