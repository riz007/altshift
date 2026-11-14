---

description: Scaffold a new framework adapter
argument-hint: <framework>
---

Scaffold an adapter for `$ARGUMENTS`.

1. Read `docs/internal/SPEC.md` section 10 and `packages/adapters/src/types.ts`.
2. Look at the existing adapters and copy their structure.
3. Before writing `collectSourceHints`, check in a real dev server (the fixture, through the Playwright MCP server) which runtime signal the framework's current version actually exposes. Do not rely on memory. Note the version you checked in a comment.
4. Implement `detect`, `defaults`, `collectSourceHints` and `promptNotes`. Keep `promptNotes` under 25 lines, and only include conventions that change how a fix should be written.
5. Add unit tests for `detect`, using `package.json` samples.
6. Register the adapter in `packages/adapters/src/index.ts`.
7. Update the tier table in `docs/internal/SPEC.md` section 3 only if the maintainer agrees.

Stop and ask if the framework has no reliable source signal in dev.
