# CLAUDE.md

@AGENTS.md

`AGENTS.md` holds the shared rules and is loaded above. `docs/internal/SPEC.md` is long, so read the sections a task needs instead of loading the whole file every session. This file adds Claude Code guidance.

## How to work

1. Find the current milestone in `docs/internal/DECISIONS.md`, then read the matching `docs/internal/SPEC.md` sections.
2. Read the existing code and follow its patterns.
3. For anything touching more than two files, or anything in `packages/fix`, write a short plan first and wait for a go-ahead.
4. Make the smallest change that meets the requirement. Write the test with it, or before it.
5. Run `pnpm check`.
6. Report honestly (see below).

Do not start the next milestone unless asked.

## Priorities when they conflict

1. Correct pass or fail results, and fixes that never break the customer's code
2. Security and honest claims
3. Low noise for developers
4. Fast setup
5. Extra features

False passes, noisy false failures and fixes that break the UI are all serious bugs.

## Fix engine work

- Treat `packages/fix/prompts/` like code. Version each file, keep changes small, and run the relevant eval cases before and after.
- When changing the agent loop, think through how a malicious string in page content or a repo comment would play out. Add a fixture for it if one does not exist.
- Use the `a11y-reviewer` subagent to review any change to rule tiers, prompts or gate logic, and the `security-reviewer` subagent for anything touching tools, gates, secrets or Action triggers.
- Keep Fable 5.2 for the hard step only. If a task can be done with deterministic code or a cheaper model, do it that way.

## Browser checks

The Playwright MCP server in `.mcp.json` lets you open fixtures in a real browser. Use it to confirm what axe and the DOM actually show before writing a selector, normalization rule or source-hint function. Never point it at a production site.

## Useful slash commands

- `/next-task`: pick the next unchecked item in the current milestone and plan it
- `/add-fixture <framework> <rule>`: add a seeded violation to a fixture app
- `/add-adapter <framework>`: scaffold a new framework adapter
- `/eval [case-glob]`: run fix evals and compare with the last result
- `/review`: review the working-tree diff against `AGENTS.md` and `docs/internal/SPEC.md`

## Reporting

End each task with:

- What changed
- Which commands ran, and whether they passed
- Anything skipped, untested or uncertain
- Any `docs/internal/SPEC.md` question that needs a decision

Never say a change works if you did not test it. Never commit or push. The maintainer does that after testing on his own machine.
