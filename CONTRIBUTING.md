# Contributing

## You do not need provider API keys

This is the part worth knowing before anything else. Contract tests replay **recorded** provider responses, so you can write an adapter, run the whole test suite and open a PR with nothing but Node, pnpm and Docker.

```bash
pnpm bootstrap    # once: checks your toolchain, installs, builds
pnpm dev          # the gateway on :8787
pnpm check        # before you push — everything CI will run
```

**Those three are the whole surface.** There are twenty-odd other commands; each is one role's exit criterion, and CI runs them. `pnpm check` derives its list from `scripts/commands.json`, so it is always exactly what CI will run — you cannot pass locally and fail on a check you did not know about.

## The one thing that will look broken and is not

The live canary cannot run on a fork PR. GitHub does not expose secrets to forks, so the job that hits real provider APIs is skipped on your branch. **That is expected, not a failure you caused.** A maintainer runs it on house keys before merging.

## Adding a provider

```bash
pnpm new-adapter <id>              # scaffolds capabilities, schema, stubs, fixtures/
# implement translate() and parse()
pnpm conformance --adapter=<id>    # the bar
```

`pnpm conformance` is the contribution bar: implement the interface, record fixtures, make it green. It checks purity, that no provider default leaks, that outcomes stay inside the taxonomy, and that your fixtures parse to what they claim.

Recording needs a key of your own — a trial account is enough:

```bash
export <PROVIDER>_KEY=...
pnpm record --adapter=<id> --dry-run   # prints the plan, spends nothing
pnpm record --adapter=<id>
```

**Never hand-write a fixture.** CI cannot tell a recording from a fabrication, and a fabricated one makes the whole contract-test layer decorative. This is the one rule nothing can enforce for you.

Read `docs/integrations.md` sections 2, 3 and 6 before starting. `.claude/skills/add-adapter/` is the same loop for agents.

## Pull requests

- **Conventional Commits**, enforced on the PR title and every commit subject. Keep the subject under ~66 characters — CI budgets for the `(#123)` GitHub appends.
- **Small.** Under ~400 changed lines. Review quality falls off a cliff past that: a 4,000-line PR does not get reviewed, it gets approved.
- A behaviour change needs a changeset. One sentence, user-facing.
- Docs change in the same PR as the thing they describe.

## Publishing

**`pnpm publish`, never `npm publish`.** npm leaves `workspace:*` verbatim in the published
manifest and the tarball is then uninstallable — `EUNSUPPORTEDPROTOCOL`. pnpm rewrites it to
a real version. `proxlane@0.0.0` shipped broken this way, because `npm publish --dry-run`
succeeds on it.

`pnpm release:dry` now packs with pnpm, inspects the resulting manifest, and prints the
order packages must go in — a scoped dependency has to exist on the registry before the
package that names it.

## Licence

The gateway, web app, `api`, `db`, `ui`, `route-viz` and the CLI are **AGPL-3.0-only**. `sdk`, `adapters`, `detect` and `shared` are **Apache-2.0** — so you can write an adapter, or build on the SDK, without inheriting copyleft. That split is deliberate: adapters are the thing we most want written by strangers.

Contributions are accepted under the licence of the package you are touching.
