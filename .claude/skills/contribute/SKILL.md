---
name: contribute
description: Open a pull request against Proxlane. Use when preparing a change for review — branching, commit format, changesets, which checks run locally and in CI, and what a reviewer will look for.
---

# Contributing

## Set up once

```
pnpm bootstrap
```

Preflights Node, pnpm and Docker against the pins, installs, builds, and tells you what to
run next. **It is `bootstrap`, not `setup`** — `pnpm setup` is a pnpm built-in that would
configure your shell profile and exit 0 without installing anything.

**You do not need provider API keys.** Contract tests replay recorded fixtures.

## Before you open the PR

```
pnpm repo:check     # ownership, manifest, licences, pins — the structural checks
pnpm typecheck
pnpm lint
pnpm test:unit
```

Some commands exit 1 with `NOT IMPLEMENTED`. **That is correct**, not a broken checkout —
they are wired and reachable and fail because their subject does not exist yet. The output
names the owner, the spec and the blocking file. Do not make one exit 0 to get a green
board; a unit test asserts that stubs fail.

If your change touches an adapter, `pnpm conformance --adapter=<id>` too.

## Branch and commits

Short-lived branch off `main`, squash merged, branch deleted after.

**Conventional Commits, and the PR title is what gets linted** — squash merge makes the
title the commit message, so that is the string that has to be right.

```
feat(adapters): add zyte adapter
fix(gateway): respect global deadline on redirect chains
docs(migration): add scrapingbee param mapping table
```

Scopes match package names. `feat!` or a `BREAKING CHANGE:` footer for anything altering the
public request surface — **and a changed adapter default is breaking even if no type moved.**

Subject ≤72 characters. Body only when the *why* is not obvious from the diff.

**No AI attribution.** No `Co-Authored-By: Claude`, no "Generated with" footer, no bot
signature in the PR body or comments. Commits carry the author's own identity.

## Changesets

Every behaviour change needs one. CI fails without it.

```
pnpm changeset
```

One sentence, written for someone reading a changelog — not a summary of the diff. Docs-only
and internal-tooling changes do not need one.

## What CI runs

Typecheck, lint, unit, contract replay, e2e, conformance, changeset, secret scan, docker
build. Under ten minutes. Nothing merges red.

Two things behave differently on a fork PR, both by design:

- **The live canary cannot run.** GitHub does not expose secrets to forks. A maintainer runs
  it on house keys before merge. A skipped canary is expected and is not yours to fix.
- **`security-review`** runs only when the diff touches paths in
  `scripts/security-review-paths.json`.

## PR body

Under about 15 lines: what changed, why, how to verify. The checklist comes from the
template — do not restate it in prose.

## What a reviewer looks for

- Tests that are not mocks of our own code. The network boundary is the only mocked thing,
  and it is fed by recorded traffic.
- Docs updated **in the same PR** if the public surface moved. There is no separate
  decisions log — a decision goes in the doc it changes, in the same commit.
- No secrets in fixtures, and no hand-written fixtures.
- Adapters set every parameter explicitly; provider defaults never leak.
- An external adapter PR is judged almost entirely on whether conformance passes. That is
  the point of having built it.

Merged within a week, or you get told why. A stalled first PR is a contributor lost.

## Something larger

Anything crossing package boundaries, changing the public request surface, or adding a
persisted table gets a short RFC first — an issue labelled `type:feature` with the problem,
the proposed shape, what it rules out, and one rejected alternative. Half a page.

It exists so you do not spend a weekend on something that would be declined, not to add
ceremony. Everything else goes straight to a PR.
