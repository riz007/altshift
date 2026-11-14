# Changelog

## Unreleased

- `altshift scan`: starts the dev server, scans page targets and journeys with axe-core in Chromium, and prints findings with their fix tier, or a deterministic JSON report with `--json`.
- Config moved to the `app`, `targets`, `scan` and `fix` shape. `journeys`, `minImpact`, `rules`, `exclude`, `baseline`, `fix.delivery` and `fix.maxFindingsPerRun` are gone (`fix.maxFixesPerRun` replaces the last one).
- Findings carry a versioned SHA-256 fingerprint built from a normalized selector, so the same element matches across scans.
- Nuxt 4 fixture storefront with seeded violations, and `pnpm test:fixtures`.
- The repo is MIT licensed.
- Repo scaffold: spec, agent instructions, workspace tooling, core and fix type contracts.
