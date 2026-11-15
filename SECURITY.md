# Security

Ariamend runs in your CI with an Anthropic API key and a GitHub token, reads your source code, and asks a model to change it. Please report anything that weakens that setup.

## Reporting a vulnerability

Use **GitHub's private vulnerability reporting** on this repository (Security tab, "Report a vulnerability"). Please do not open a public issue.

Include what you ran, what you expected and what happened. A failing input for the safety gate (a template change that passes but should not) is the most useful kind of report.

## What Ariamend is designed to prevent

- **Model output running as code.** The model can only stage exact-match edits through a fixed set of tools. It has no shell, no network and no direct file writes. A plain-code safety gate then reads the old and new template with your project's own Vue compiler, so it sees exactly what Vue will compile, and requires every existing node to still be there, in order, with only additions from a short list: naming and ARIA attributes, labels, simple elements and simple bindings. Script, style, comments, event handlers, links, URLs, and anything moved, swapped or removed are rejected.
- **Page and repository content steering the model.** Page text, product data, repository files and comments are passed to the model as labelled data. The gates do not trust the model's own account of its change.
- **Keys leaking into your project's code.** Your dev server, checks and build run without `ANTHROPIC_*`, `ARIAMEND_*`, GitHub tokens or the Actions files that pass state between steps. Their output is redacted before it reaches logs, the model or the evidence pack.
- **Changes to your default branch.** Ariamend commits through the GitHub API to a branch named `ariamend/debt-*`, never force-pushes and never merges. It only adds to a pull request that its own identity opened and committed to, and refuses to deliver unless the checkout is clean and still the head of the default branch.
- **Running on untrusted code.** The Action refuses to run on anything but `schedule`, `workflow_dispatch` or `push`, so pull requests, forks and comments never trigger it.

## What it does not prevent

- **Your project's own code runs** during the checks, rescan and build gates. If that code is hostile, it runs with the permissions of the CI job. Check out with `persist-credentials: false`, as the example workflow does, and give the job only `contents: write` and `pull-requests: write`.
- **Code and page snippets are sent to the Anthropic API** under your key and Anthropic's commercial terms.
- **Automated checks cannot prove a fix is right.** Every pull request needs a person to review it.

## Supported versions

Ariamend is pre-release. Only the latest commit on `main` gets fixes.
