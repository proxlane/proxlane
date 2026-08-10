---
name: resume-work
description: Work out what state this repo is in and what to do next. Use at the start of a session, after picking up someone else's branch, or whenever it is unclear what is built and what is only planned.
---

# Resuming work

**Progress in this repo is machine-readable. Do not reconstruct it from prose.**

`scripts/commands.json` records, per command, whether it is implemented and which file
defines that. `repo:check` asserts the manifest against reality, so it cannot drift the way
a status document does.

## Four commands, in order

```
pnpm repo:check          # what is built, and what is claimed but missing
git log --oneline -15    # what actually happened
gh pr list               # a half-finished branch is likelier than a clean start
pnpm check               # everything CI runs, before you push anything
```

`pnpm check` is the only one of these you need to remember later. It derives its list from
`scripts/commands.json`, so it is always exactly what CI will run — you cannot pass locally
and then fail on a check you did not know existed.

`docs/state.md` is printed automatically at session start. It carries only the two things no
command can answer: **outstanding owner decisions**, and **the one thing in flight**.
Everything else — which commands work, what changed, what is next — is a query, and if you
find those written down somewhere, that copy is stale by definition.

## If `repo:check` fails, that failure is your task

It names the owning agent, the spec section and the blocking file. You do not need to guess
priority; a red assertion is the priority.

## If a command exits 1 saying NOT IMPLEMENTED

That is working as designed, not a bug. Read the output: it tells you the owner, the spec,
the subject file whose existence would flip it, and what is blocking it.

**Never make a stub exit 0 to get a green board.** Eleven of the twelve agent briefs define
done as "command X exits 0", so a stub that exits 0 lets an agent satisfy its brief by the
letter while having built nothing — and two of these commands are launch gates, where a
vacuous pass puts a false statement in the launch record. `test/commands/manifest.unit.test.ts`
will catch it, but the reason matters more than the check.

## Flipping a command to implemented

1. Create the `subject` file.
2. Flip `status` in `scripts/commands.json` and set `ci` (`pr` or `none`).
3. Replace the root script's `not-implemented.ts` invocation with the real one.
4. `pnpm repo:check` — assertion 2 fails loudly on any of 1, 2 or 3 done without the others.

**Step 3 is the one that gets skipped, and it hid for days.** `new-adapter` and `record`
both sat at `status: implemented` with their subject files on disk while `pnpm new-adapter`
and `pnpm record` still ran the stub and exited 1. The manifest — the thing that exists so
progress cannot drift — was wrong about two of its nine implemented commands.

Assertion 2 could not see it, because it only checked that the SUBJECT existed, and
`scripts/record.ts` did exist. Existence is not reachability. It survived because the work
was done by running `node scripts/record.ts` directly, so the documented interface was
broken the entire time and nobody had reason to notice. The assertion now also checks that
an implemented root script does not invoke the stub harness — but run the real
`pnpm <command>` yourself anyway, at least once.

Set `ci: none` for anything persistent or scheduled. `dev` is `none` because a persistent
task in the matrix hangs the build.

## Leaving work half-done

Commit with `wip(scope): <what is done> / <what is next>` and update `docs/state.md` **in
the same commit**, not at the end of a session — an interrupted session never reaches the
end, and the next reader gets a confidently stale file, which is worse than an empty one.

## House rules that are easy to trip over

- Docs update in the **same PR** as the change. There is no separate decisions log.
- Every behaviour change carries a changeset.
- Provider defaults never leak; adapters set every parameter explicitly.
- The hot path never writes synchronously to Postgres.
- The README describes shipped behaviour only.
- Never hand-write a fixture.
- **No AI attribution** in commits, PRs or issues — no `Co-Authored-By`, no generated-with
  footer.
- Keep it short. PR bodies under ~15 lines; commit subjects ≤72 chars.
