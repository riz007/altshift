# ariamend

Fixes accessibility findings in your storefront's source code, proves every fix with plain-code checks, and opens one pull request with an evidence pack your team, or your client, can read.

Nuxt and Vue first. Next.js is next.

```bash
pnpm add -D ariamend
```

```bash
pnpm exec ariamend install-browser
```

```ts
// ariamend.config.ts
import { defineConfig } from "ariamend";

export default defineConfig({
  app: {
    dev: { command: "pnpm dev", url: "http://localhost:3000" },
    build: "pnpm build",
    checks: ["pnpm typecheck", "pnpm lint"],
  },
  targets: { pages: ["/", "/cart"] },
});
```

```bash
pnpm exec ariamend scan
```

```bash
ANTHROPIC_API_KEY=... pnpm exec ariamend fix --dry-run
```

`fix --dry-run` asks Claude for a fix to each finding and runs it through six checks: allowed files only, a safety check on the template, your own checks, a rescan, a visual comparison and your build. It prints what passed and leaves your files as they were. Without `--dry-run`, and with `GITHUB_TOKEN` set, it opens one pull request with only the fixes that passed.

Automated tools find only part of WCAG issues. Ariamend never claims a site is accessible or compliant, and every pull request needs a person to review it.

Documentation, the GitHub Action and the security model: see the repository README.

MIT licence.
