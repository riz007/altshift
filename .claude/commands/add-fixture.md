---

description: Add a seeded accessibility violation to a fixture app
argument-hint: <framework> <axe-rule-id>
---

Add a seeded violation for `$ARGUMENTS`.

1. Read `fixtures/README.md` for the fixture conventions.
2. If the framework fixture does not exist yet, stop and say so. Creating a fixture app is a separate task.
3. Add the violation in a realistic storefront component, not a bare test page. Mark it with a comment in the form `altshift-seed: <rule-id> <short reason>` so evals can find it.
4. If the violation only appears after interaction (a modal, a form error), add or extend a journey that reaches that state.
5. Add or update the eval case in `evals/cases/` with the fixture, journey, checkpoint and rule, plus `mustContain` and `mustNotContain` checks for an acceptable fix.
6. Run the fixture journey and confirm axe reports exactly the expected rule at the expected checkpoint. Use the Playwright MCP server to inspect the page if needed.

Report which fingerprint the seed produces.
