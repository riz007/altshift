# Changelog

## 0.1.0 (2026-11-15)

First release. Nuxt and Vue projects; Next.js is next. Early: expect rough edges, and review every pull request it opens.

- **Renamed from AltShift to Ariamend.** The package is `ariamend`, the config file `ariamend.config.ts`, environment variables `ARIAMEND_*`, the evidence folder `.ariamend/` and branches `ariamend/debt-*`.
- One public package, `ariamend`: the command line plus `defineConfig` and `defineJourney`. Everything else is bundled into it.
- The GitHub Action runs the project's installed `ariamend` (add it as a dev dependency). New input `working-directory`. New command `ariamend install-browser`.

- `ariamend scan`: starts the dev server, scans page targets and journeys with axe-core in Chromium, and prints findings with their fix tier, or a deterministic JSON report with `--json`.
- Config moved to the `app`, `targets`, `scan` and `fix` shape. `journeys`, `minImpact`, `rules`, `exclude`, `baseline`, `fix.delivery` and `fix.maxFindingsPerRun` are gone (`fix.maxFixesPerRun` replaces the last one).
- Findings carry a versioned SHA-256 fingerprint built from a normalized selector, so the same element matches across scans.
- Nuxt 4 fixture storefront with seeded violations, and `pnpm test:fixtures`.
- Nuxt adapter: framework detection, prompt notes, and source hints read from Vue's dev-only component metadata.
- Fix engine building blocks, with no model involved yet: a path guard, the eight agent tools, the six gates (scope, safety, checks, rescan, visual, build), a workspace that applies and reverts fixes, and deterministic triage.
- Commands Ariamend runs for the project (dev server, checks, build) no longer receive API keys or tokens in their environment.
- `ariamend fix --dry-run`: scans, groups findings by component, asks Claude for a fix per group, runs each through scope, safety, checks, rescan and visual gates, runs the build gate on everything kept, prints diffs and gate results, and restores the working tree. `--finding` limits it to one finding.
- The safety gate allows only changes to a Vue component's `<template>`, from an allowlist of tags, attributes and simple bindings. `html-has-lang`, `html-lang-valid` and `document-title` moved from the `auto` tier to `suggest`.
- Cost is metered per call from published prices and capped by `fix.budgetUsd`. A model with no price stops the run before it starts.
- `pnpm evals` and ten eval cases for the Nuxt fixture. First results are in `evals/results/`.
- `.gitignore` now covers every `.env*` file except `.env.example`.
- The repo is MIT licensed.
- Repo scaffold: spec, agent instructions, workspace tooling, core and fix type contracts.
