# Fix evals

Fix quality is the product, so every prompt, model or gate change gets measured here.

## Layout

```text
evals/
  cases/      one JSON file per case
  results/    <date>-<model>.json, committed so runs can be compared
  runs/       raw traces and screenshots, git-ignored
```

## Case format

See `cases/nuxt-button-name-cart-close.json`. Each case names:

- `fixture`, `target`, `checkpoint`, `ruleId`: where the seeded violation shows up
- `expect.files`: files a good fix may touch
- `expect.mustContain` and `expect.mustNotContain`: strings checked in the lines the fix adds
- `expect.outcome`: `accepted`, `suggested` or `rejected`
- `notes`: what a reviewer should look for. Not machine-checked

## Metrics

Fix rate, regression rate, reviewer acceptance (sampled by hand), cost per accepted fix, time per fix, refusals and fallbacks.

## Bar for selling a tier

At least 80% fix rate and zero regressions on the Tier-1 fixtures. These are targets to revisit, not promises.

## Running

```bash
pnpm evals
```

It builds the packages, runs the fix engine once on each fixture that has cases, scores every case and writes `evals/results/<date>-<model>.json` with the scores, the diffs and any gate that rejected an attempt. It needs `ANTHROPIC_API_KEY` in `.env.local`.

A full run on the Nuxt fixture costs about $1. Every run spends real money, so check the last result's cost first.

Passing a case means the fix cleared every gate and met the case's string checks. It does not mean the fix is right: read the diffs. The `notes` in each case say what to look for.
