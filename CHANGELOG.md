# Changelog

## Unreleased

- `altshift scan`: starts the dev server, scans page targets and journeys with axe-core in Chromium, and prints findings with their fix tier, or a deterministic JSON report with `--json`.
- Config moved to the `app`, `targets`, `scan` and `fix` shape. `journeys`, `minImpact`, `rules`, `exclude`, `baseline`, `fix.delivery` and `fix.maxFindingsPerRun` are gone (`fix.maxFixesPerRun` replaces the last one).
- Findings carry a versioned SHA-256 fingerprint built from a normalized selector, so the same element matches across scans.
- Nuxt 4 fixture storefront with seeded violations, and `pnpm test:fixtures`.
- Nuxt adapter: framework detection, prompt notes, and source hints read from Vue's dev-only component metadata.
- Fix engine building blocks, with no model involved yet: a path guard, the eight agent tools, the six gates (scope, safety, checks, rescan, visual, build), a workspace that applies and reverts fixes, and deterministic triage.
- Commands AltShift runs for the project (dev server, checks, build) no longer receive API keys or tokens in their environment.
- The repo is MIT licensed.
- Repo scaffold: spec, agent instructions, workspace tooling, core and fix type contracts.
