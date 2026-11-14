---

## description: Review the working-tree diff against AGENTS.md and docs/internal/SPEC.md

Review the current uncommitted changes (`git diff` and `git status`).

Check against:

1. The non-negotiable rules and fix engine rules in `AGENTS.md`
2. The `docs/internal/SPEC.md` sections the change touches
3. Missing tests, especially failure paths
4. Any breaking change from the `AGENTS.md` list that is not called out
5. New dependencies
6. Code or docs that read as generated filler

If prompts, rule tiers or gates changed, also run the `a11y-reviewer` subagent. If tools, gates, secrets or Action triggers changed, also run the `security-reviewer` subagent.

Reply with findings ordered by severity, each pointing to a file and line. Say plainly if nothing needs to change. Do not edit files.
