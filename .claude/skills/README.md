# Skills

Task-shaped instructions for coding agents working in this repo. Each folder holds a
`SKILL.md` with YAML frontmatter (`name`, `description`) and the instructions below it.

## How they get used

Claude Code reads `.claude/skills/` automatically and offers each skill by its
`description` — you do not need to load them by hand, and an agent will pick one up when the
task matches. Other agent tools read `AGENTS.md`, which symlinks to `CLAUDE.md`, so everyone
gets the same ownership table, house rules and command contract even without skill support.

**One of these is not like the others.** `use-proxlane` is for people USING proxlane, not
building it, so it lives in `packages/cli/skills/` and ships with the npm package — a
consumer running `npx proxlane` in their own project never sees this directory. The entry
here is a symlink to that one file, so the two cannot drift.

## What is here

| Skill | Use it when |
|---|---|
| `resume-work` | Starting a session, or picking up a branch you did not write. Explains how to read repo state from commands rather than prose |
| `contribute` | Opening a pull request. Branch, commits, changesets, which checks run, what a reviewer will look for |
| `add-adapter` | Adding a provider, or re-recording one after drift |
| `use-proxlane` | **Consumer-facing.** Using proxlane from a script or an agent — the CLI and the HTTP gateway, the JSON contract, exit codes, and what an outcome means for retrying |

## Where the boundary is

**`CLAUDE.md`** — who owns what, house rules, pinned versions, the command contract. Facts
that are true regardless of what you are doing.

**`docs/`** — the specifications. `integrations.md` for the adapter contract and the outcome
taxonomy, `operations.md` for the runtime, `operating.md` for repo process, `design.md` for
the UI. Routed by the table at the top of `CLAUDE.md`.

**Skills** — the loop for one kind of task, with the order and the traps. They point at the
specs rather than restating them, because a copy drifts.

## Adding one

Keep it to the loop and the traps. If you find yourself explaining *what* something is
rather than *how to do it*, that belongs in `docs/` and the skill should link to it.

State the failure mode, not just the rule — "never hand-write a fixture" is forgettable;
"CI cannot tell a recording from a fabrication, so this one is on you" is not.
