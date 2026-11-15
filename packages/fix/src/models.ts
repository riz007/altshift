// The only place model IDs are written down (AGENTS.md). Config and env vars override them.

export interface ModelRouting {
  /** Localize and propose. The hard step. */
  fix: string;
  /** Grouping, ordering and short explanations. */
  triage: string;
  /** Used after a refusal, a rate limit or an outage on the fix model. */
  fallback: string;
}

export const DEFAULT_MODELS: ModelRouting = {
  fix: "claude-fable-5-2",
  triage: "claude-haiku-5-5",
  fallback: "claude-sonnet-5-5",
};

/**
 * Thinking depth for the fix model. Fixes are small, well-specified edits, and evals should show
 * a quality gain before this goes up: it is the main driver of cost per fix.
 */
export const FIX_EFFORT = "medium" as const;

export const MAX_OUTPUT_TOKENS = 16_000;

export function resolveModels(
  fromConfig: Partial<ModelRouting> = {},
  env: Record<string, string | undefined> = process.env,
): ModelRouting {
  return {
    fix: env.ARIAMEND_MODEL_FIX || fromConfig.fix || DEFAULT_MODELS.fix,
    triage: env.ARIAMEND_MODEL_TRIAGE || fromConfig.triage || DEFAULT_MODELS.triage,
    fallback: env.ARIAMEND_MODEL_FALLBACK || fromConfig.fallback || DEFAULT_MODELS.fallback,
  };
}
