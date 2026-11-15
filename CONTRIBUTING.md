# Contributing

Thanks for helping. Ariamend changes other people's source code, so the bar for correctness is high and changes stay small.

## Setup

```bash
pnpm install
```

```bash
pnpm --filter ariamend exec playwright install chromium
```

You need Node 22.18 or newer (24 recommended) and pnpm 10.

## Before you open a pull request

```bash
pnpm check
```

```bash
pnpm test:fixtures
```

`pnpm check` runs Biome, the type checker and the unit tests. Unit tests never reach the network and never call a model. `pnpm test:fixtures` scans the fixture storefront in real Chromium.

`pnpm evals` calls the real model and costs about $1 a run. Only run it when you change a prompt, a gate or model settings, and put the before and after numbers in your pull request.

## What we look for

- A test with every behaviour change, including the failure path.
- No new runtime dependency without discussing it first.
- Output that is the same on every run: sort before writing.
- Safety gate changes come with failing inputs. If you widen what the gate allows, show the template strings you checked.
- Nothing that claims a site is accessible or compliant, in code, docs or output.
- Comments that explain why, not what.

[AGENTS.md](AGENTS.md) has the full working rules. Coding agents read it too.

## Security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
