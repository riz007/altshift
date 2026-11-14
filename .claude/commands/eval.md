---

description: Run fix evals and compare with the last result
argument-hint: "[case-glob]"
---

Run the fix evals for `$ARGUMENTS` (all cases if empty).

1. Read `evals/README.md`.
2. Estimate the cost from the number of cases and the last run's cost per case. If it is over $3, stop and ask first.
3. Run the evals and save the results to `evals/results/`.
4. Compare with the most recent previous result for the same cases. Show a table of fix rate, regression rate, cost per accepted fix and refusals, before and after.
5. List every case that changed outcome, with the gate that decided it.

Do not change prompts or code in this command. Report only.
