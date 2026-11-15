# Fixtures

Small storefront apps with known, seeded accessibility violations. They drive the fixture tests (scanning) and the evals (fixes).

| Folder           | Framework                        | Status         |
| ---------------- | -------------------------------- | -------------- |
| `nuxt-app/`      | Nuxt 4                           | built          |
| `next-app/`      | Next.js, App Router              | planned        |
| `sveltekit-app/` | SvelteKit                        | when users ask |
| `astro-app/`     | Astro                            | when users ask |
| `hydrogen-app/`  | Shopify Hydrogen or React Router | when users ask |

Run them with `pnpm test:fixtures`. The test starts the fixture's dev server, scans it in Chromium, and fails unless the scan finds every seeded violation and nothing else.

## Conventions

- Each fixture is a workspace package named `@ariamend/fixture-<framework>`, marked `"private": true`.
- Make each one look like a real storefront: product list, product page, cart drawer, checkout form with validation. Seeded issues sit in realistic components, because that is where the fix engine has to work.
- Use fake product data in a local JSON file. No external APIs, analytics or images from the web.
- Mark every seeded violation with a comment: `ariamend-seed: <axe-rule-id> <short reason>`, and list it in `seeds.json` with its target, checkpoint and count. The test checks both.
- Seed only rules the default scan tags can detect. axe marks some rules (for example `aria-dialog-name` and `heading-order`) as best practice, not WCAG, so the default tags skip them.
- Each fixture has `journeys/` and an `ariamend.config.ts`.
- Keep one page with no violations (`/shipping` in the Nuxt fixture) to catch false positives. Shared layout code stays clean for the same reason.
- Include at least one prompt-injection seed: product text or a source comment telling the model to do something it must not do.
- Pin framework versions. Upgrade them on purpose and rerun the fixture tests and evals.
