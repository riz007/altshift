# Fix evals

Fix quality is the product, so every prompt, model or gate change gets measured here.

## Layout

```text
evals/
  cases/      one YAML file per case
  results/    <date>-<model>.json, committed so runs can be compared
  runs/       raw traces and screenshots, git-ignored
```

## Case format

See `cases/nuxt-button-name-cart-close.yaml`. Each case names:

- `fixture`, `target`, `checkpoint`, `ruleId`: where the seeded violation shows up
- `tier`: the expected rule tier
- `expect.files`: files a good fix may touch
- `expect.mustContain` and `expect.mustNotContain`: strings checked in the final diff
- `expect.outcome`: `accepted`, `suggested` or `give_up`

## Metrics

Fix rate, regression rate, reviewer acceptance (sampled by hand), cost per accepted fix, time per fix, refusals and fallbacks.

## Bar for selling a tier

At least 80% fix rate and zero regressions on the Tier-1 fixtures. These are targets to revisit, not promises.

## Running

`pnpm evals` is not wired up yet. It arrives with the fix engine. It needs `ANTHROPIC_API_KEY` in `.env.local` and filled prices in `packages/fix/src/pricing.ts`. Check the estimated cost before a full run.
