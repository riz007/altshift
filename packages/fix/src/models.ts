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

export function resolveModels(
  fromConfig: Partial<ModelRouting> = {},
  env: Record<string, string | undefined> = process.env,
): ModelRouting {
  return {
    fix: env.ALTSHIFT_MODEL_FIX || fromConfig.fix || DEFAULT_MODELS.fix,
    triage:
      env.ALTSHIFT_MODEL_TRIAGE || fromConfig.triage || DEFAULT_MODELS.triage,
    fallback:
      env.ALTSHIFT_MODEL_FALLBACK ||
      fromConfig.fallback ||
      DEFAULT_MODELS.fallback,
  };
}
