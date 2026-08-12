# Proxlane

Open source scraping proxy gateway. One endpoint in front of every scraping API
provider, with automatic failover, cost-aware routing, and honest success detection.
BYOK free forever, self-hostable, hosted credits at provider cost plus 5%.

## Docs, routed by when to read them

**Every session:** `docs/state.md` — what is in flight, what is next, what is blocked.
Short by design; the SessionStart hook prints it.

**When you touch the thing it specifies:**

| Doc | Read it when |
|---|---|
| `docs/integrations.md` | writing an adapter, the detector, the router, or anything about outcomes, cost, or testing |
| `docs/operations.md` | working on the gateway runtime, queues, schema, payments, security, or OSS process |
| `docs/design.md` | anything in `apps/web`, `packages/ui`, or `packages/route-viz` |
| `docs/operating.md` | writing content, or working on repo process, CI cadence, or releases |
| `docs/plan.md` | you need a phase boundary, a scope call, or the reasoning behind one |
| `docs/landing-mockup.html` | building the marketing hero |
| `docs/affiliate-emails.md` | Phase 0 outreach only |

**Do not read `docs/archive/`.** It holds decisions already extracted into the files
above — the rejected design directions and read-once strategy prose. It exists so the
reasoning survives, not so it gets loaded.

## Decisions already made, do not relitigate without a reason

- **Runtime: Node, not Bun.** The gateway needs undici's per-origin pools and
  explicit `headersTimeout`/`bodyTimeout` per provider. See `plan.md` section 3.
- **Web: TanStack Start**, not Next.js. Hono for the gateway.
- **UI: Base UI wrapped once in `packages/ui`.** Never shadcn defaults, never any
  library's default theme. Tailwind v4 tokens hand-authored.
- **Design: direction D**, the transit diagram. Providers are lines, failover is an
  interchange.
- **License: AGPL-3.0-only** for the gateway, web, `api`, `db`, `ui`, `route-viz` and the
  CLI. **Apache-2.0** for `sdk`, `adapters`, `detect` and `shared` — adapters are the thing
  we most want written by strangers, and `shared` is permissive because the other three
  import it (Apache-on-AGPL is the direction that relicenses). The CLI is AGPL and
  publishable: it is an operator tool, not an integration surface, and no document asks for
  it to be permissive. `repo:check` assertion 10 enforces the direction. CLA via
  cla-assistant.
- **Package layering is declared, and enforced two ways.** `shared` is the base and depends
  on nothing internal; `adapters` and `detect` sit above it; the deployables sit on top. The
  outcome taxonomy lives in `packages/shared/src/outcome.ts` and `adapters` re-exports it, so
  adapter authors still import everything from `@proxlane/adapters`.
  This is a correction, not a preference: the taxonomy used to live in `adapters`, which
  forced `shared` to depend on a leaf, locked `adapters` out of `shared` entirely, and handed
  the taxonomy to adapter-engineer under CODEOWNERS when it drives failover, cooldowns, HTTP
  status and health. `repo:check` assertion 20 checks the manifests; a `biome` override
  catches the import before the manifest changes. **turbo only reports a cycle once it is
  complete**, so a one-way inversion builds fine and stays invisible.
- **Testing: nothing mocked but the network boundary**, and that is fed by recorded
  real provider traffic. Real Postgres and Valkey via testcontainers.
- **Launch adapters: ScraperAPI, ScrapingBee, Scrapfly.**
- **Launch modes: BYOK and self-host only.** Hosted credits are phase 3, and gated on
  the margin decision in `plan.md` section 7.

## Pinned toolchain

Verified 2026-08-06. Do not invent versions; if one looks stale, check the registry and
update this table in the same PR.

**The rule is not "latest".** It is *latest compatible with everything else in this table,
with the reason in the Why column* — two rows below are deliberately behind, and both would
break the build if bumped mechanically.

`Kind` has exactly three values and each maps to one `repo:check` assertion:
**`npm`** rows must appear in `pnpm-workspace.yaml`'s `catalog:` with the same range
(assertion 6); **`runtime`** rows are checked against `.nvmrc` and `packageManager`
(assertion 7); **`image`** rows against `tooling/containers/images.ts` (assertion 8).
Do not add a fourth kind without an assertion behind it — a row nothing checks is drift
waiting to happen, which is the whole reason this table is machine-parsed.

| Thing | Kind | Package | Pin | Why this one |
|---|---|---|---|---|
| Node | runtime | `node` | `24.19.0` | 22 entered maintenance 2025-10-21. 24 is Active until 2026-10-20 and supported to 2028-04-30. Revisit 26 shortly after launch, not during it |
| Package manager | runtime | `pnpm` | `10.34.5` | latest is 11.x. **Publishing depends on staying here.** pnpm 10 rewrites `workspace:*` and then delegates to the npm CLI, which is what performs the OIDC exchange; pnpm 11.0.x reimplemented publish natively and broke it, repaired in 11.0.7. See `operating.md` B8 before bumping. The exact string with its integrity hash lives in `packageManager` — captured at scaffold time, never drifts |
| Postgres | image | `pgvector/pgvector` | `pg17` | matches the existing box, one fewer version in the house — and the image is already resident there, so reusing it costs no extra disk |
| Cache | image | `valkey/valkey` | `8-alpine` | BSD and Linux Foundation, chosen deliberately rather than inherited from a tag. Note `redis:7` resolves to 7.4.x, which is RSALv2/SSPL |
| Base UI | npm | `@base-ui/react` | `^1.6.0` | **not `@base-ui-components/react`**, which is abandoned at `1.0.0-rc.0` and is what a model reaches for by default. The catalog does not close this trap — the wrong package resolves cleanly at a literal — so assertion 11 bans the name outright |
| HTTP | npm | `undici` | `^8.9` | the reason we are on Node; not Node's bundled copy, so tuning is reproducible |
| Valkey client | npm | `ioredis` | `^6.0` | speaks to Valkey unchanged |
| Gateway | npm | `hono` | `^4.12` | |
| Gateway server | npm | `@hono/node-server` | `^2.1` | |
| ORM | npm | `drizzle-orm` | `^0.45` | still pre-1.0; partitioned tables are raw SQL, see `plan.md` section 3 |
| Migrations | npm | `drizzle-kit` | `^0.31` | pairs with drizzle-orm, also pre-1.0 — pin both tight |
| Validation | npm | `zod` | `^4.4` | |
| Logging | npm | `pino` | `^10.3` | |
| Key encryption | npm | `libsodium-wrappers` | `^0.8` | sealed provider keys, `operations.md` section 5 |
| Auth | npm | `better-auth` | `^1.6` | generates its own Drizzle schema — sequence it *before* the hand-written one |
| Web framework | npm | `@tanstack/react-start` | `^1.168` | |
| React | npm | `react` | `^19.2` | |
| React DOM | npm | `react-dom` | `^19.2` | |
| React types | npm | `@types/react` | `^19.2` | major-matched to react |
| React DOM types | npm | `@types/react-dom` | `^19.2` | major-matched to react-dom |
| Bundler | npm | `vite` | `^8.2` | TanStack Start's bundler |
| CSS | npm | `tailwindcss` | `^4.3` | v4, hand-authored tokens, never a library default theme |
| TypeScript | npm | `typescript` | `^5.9` | **latest is 7.0.2, the Go rewrite** — not a drop-in for 5.x and it breaks `integrations.md` section 7's assumptions. Revisit after launch, not during it |
| Node types | npm | `@types/node` | `^24` | **latest is 26.x** — major-matched to the Node pin, or you silently type Node 26 APIs onto a Node 24 runtime |
| Task runner | npm | `turbo` | `^2.10` | |
| Linter | npm | `@biomejs/biome` | `^2.5` | one config at root, CI fails on diff |
| Test runner | npm | `vitest` | `^4.1` | `projects` is the v3+ API; `workspace` is gone |
| Package build | npm | `tsdown` | `^0.22` | pre-1.0, pin tight |
| Containers | npm | `testcontainers` | `^12.1` | versions must match the compose file — assertion 8 |
| Versioning | npm | `@changesets/cli` | `^2.31` | |

**k6 is deliberately absent.** The npm package is a `0.0.0` placeholder; k6 is a Go binary
from brew/apt. Giving it a row would need a fourth kind that no assertion covers, and if
`repo:check` shelled out to `k6 version` then PR 1 would fail its own exit criterion from a
clean clone. Its version is documented in `scripts/README.md`, and `k6:soak`'s stub reports
its absence.

## Target layout and ownership

Total and disjoint: every path has exactly one owner, and this table is the `CODEOWNERS`
seed — **generated** by `scripts/codeowners.ts`, never hand-edited. If you add a path, add
a row. `repo:check` assertion 4 fails if any tracked file matches no row.

**Every Path cell must be backticked globs and nothing else.** The generator parses this
column, so a prose cell like "repo furniture, templates" silently produces no pattern and
leaves those files unowned — which assertion 4 then reports against the whole repo rather
than against the row that caused it.

**Order matters — `CODEOWNERS` takes the last matching pattern**, so general rows come
before their children. Get either pair below backwards and the k6 harness or the CI
workflows silently change hands, *and assertion 3 still passes*, because the generated file
faithfully reflects a table that is now wrong.

| Path | What | Owner |
|---|---|---|
| `apps/gateway/**` | Hono. The proxy. Hot path only | platform-engineer |
| `apps/web/**` | TanStack Start. Landing, docs, dashboard, auth UI | design-engineer |
| `apps/web/content/**` | hand-written MDX pages | seo-content |
| `apps/web/src/generators/**` | generated pages, sitemap, OG, affiliate flow | growth-engineer |
| `apps/web/src/routes/docs/**` | docs site, `llms.txt`, markdown-at-`.md`, OpenAPI | docs-writer |
| `apps/worker/**` | queues. Owned now, created by the PR that adds the first one | data-engineer |
| `packages/adapters/**` | adapters, capability registry, cost tables | adapter-engineer |
| `packages/detect/**` | soft-block heuristics and the block-page corpus | adapter-engineer |
| `packages/api/**` | oRPC contract, served by `apps/web` | platform-engineer |
| `packages/shared/**` | the outcome taxonomy, `GatewayRequest`, config, constants, the edge guard | platform-engineer |
| `packages/sdk/**` | `@proxlane/sdk` and the MCP server | platform-engineer |
| `packages/db/**` | Drizzle, migrations, rollups, ledger, worker queues | data-engineer |
| `packages/ui/**` | Base UI wrapped, tokens, primitives | design-engineer |
| `packages/route-viz/**` | the lane diagram: hero, dashboard, SEO pages | design-engineer |
| `packages/cli/**` | the unscoped `proxlane` package and `doctor`, including its output text | devex-engineer |
| `docker/**` `/Dockerfile` `/.dockerignore` | the self-host image and the compose files | devex-engineer |
| `.githooks/**` | pre-commit and pre-push. The fast local copy of what the `main` ruleset now enforces server-side | devex-engineer |
| `scripts/**` | the command manifest, the stub harness, repo:check, generators | devex-engineer |
| `tooling/**` | tsconfig, vitest config, container image constants | devex-engineer |
| `test/**` | test harnesses that are not a package's own | devex-engineer |
| `test/k6/**` | the load harness. **After `test/**`** — last match wins | devex-engineer |
| `.github/**` | templates, `CODEOWNERS`, `FUNDING.yml` | oss-maintainer |
| `.github/workflows/**` `/renovate.json` | CI matrix, Renovate, image build. **After `.github/**`** | devex-engineer |
| `.github/workflows/release.yml` | publishing. **After `workflows/**`** | release-manager |
| `.changeset/**` | changesets | release-manager |
| `**/CHANGELOG.md` | generated changelogs. **After every package row** — last match wins, and these belong to release-manager wherever they land | release-manager |
| `/SECURITY.md` | disclosure process. See the note below on scope | security-engineer |
| `/CONTRIBUTING.md` `/CODE_OF_CONDUCT.md` | contributor-facing furniture | oss-maintainer |
| `/README.md` `/LICENSE` | the front door, and the grant behind it | oss-maintainer |
| `/AGENTS.md` | symlink to `CLAUDE.md`; git tracks it as its own path | oss-maintainer |
| `/CLAUDE.md` | ownership, commands, toolchain — the source of three assertions | devex-engineer |
| `docs/**` | strategy, integrations, operations, operating, state | devex-engineer |
| `.claude/**` | agent briefs, hooks, settings | devex-engineer |
| `/package.json` `/pnpm-workspace.yaml` `/pnpm-lock.yaml` `/turbo.json` `/biome.json` `/vitest.config.ts` `/tsconfig.json` `/.npmrc` `/.nvmrc` `/.gitattributes` `/.gitignore` `/.env.example` | root config. Globs in the Path cell, never prose — the generator parses this column | devex-engineer |

**`SECURITY.md` is the only path security-engineer owns, and that is deliberate.**
`CLAUDE.md` used to list "SSRF guard, key encryption, env parsing" alongside it, which reads
as a path claim and puts security-engineer in conflict with platform-engineer over
`packages/shared/**`. Those are a **review** scope, not paths — security-engineer has no
write tools and cannot own code it cannot edit. The routing is B6's conditional
`security-review` job, whose trigger set lives in `scripts/security-review-paths.json` and
is read by both the workflow and `repo:check`.

**community-manager owns no repo paths** and therefore has no row. A `*(no repo paths)*`
cell would be parsed as a pattern and match nothing.

One dependency the table cannot express: **devex-engineer builds `test/k6/**`, and
platform-engineer's exit criterion runs it.** Sequence accordingly.

## Commands

**This is the contract the scaffold must satisfy.** Every command below exists and exits
with a real code before anything else merges, even if it starts as a stub that fails
honestly. Each agent's exit criterion is one of these.

`scripts/commands.json` is the machine-readable mirror of this table. `repo:check`
**derives** the count by parsing here — never from a literal — so adding a row is a one-line
edit rather than a refactor. Cell parse rules: split on `·`, take the backticked tokens,
strip a leading `pnpm `, drop `[…]` and `<…>` argument placeholders.

| Command | What it gates |
|---|---|
| `pnpm bootstrap` | a contributor's first command. Preflights Node/pnpm/Docker, installs, builds. **Not `pnpm setup`** — that is a pnpm built-in and would silently run pnpm's own command and exit 0 |
| `pnpm check` | **the one command before you push.** Runs every PR-blocking check, derived from `commands.json` so it cannot drift |
| `pnpm dev` · `build` · `typecheck` · `lint` | the basics |
| `pnpm test:unit` · `test:contract` · `test:e2e` | the three PR-blocking layers |
| `pnpm --filter @proxlane/db test` | data-engineer: migration round-trip, partition rotation |
| `pnpm test:live` | the canary, scheduled not PR-blocking |
| `pnpm conformance [--adapter=<id>]` | adapter-engineer |
| `pnpm new-adapter <id>` · `pnpm record --adapter=<id>` | adapter authoring |
| `pnpm k6:soak` | platform-engineer |
| `pnpm lighthouse:assert` · `pnpm tokens:check` | design-engineer |
| `pnpm selfhost:smoke` | devex-engineer |
| `pnpm pages:check` | growth-engineer |
| `pnpm content:lint` | seo-content |
| `pnpm docs:check` | docs-writer |
| `pnpm test:ssrf` | security-engineer |
| `pnpm repo:check` | oss-maintainer |
| `pnpm release:dry` | release-manager |
| `proxlane doctor` | the self-host support surface |

## Starting a session

`docs/state.md` is printed for you by the SessionStart hook. Then:

```
pnpm repo:check          # what is built vs only claimed
git log --oneline -15
gh pr list               # a half-finished branch is likelier than a clean start
```

**If `repo:check` fails, that failure is your task.** It names the owning agent, the spec
section and the blocking file. Progress lives in `scripts/commands.json` and is asserted
against reality, so it cannot drift the way a status document does — `state.md` carries only
what no command can answer: outstanding owner decisions, and the one thing in flight.

Task-shaped guidance lives in `.claude/skills/` — **`resume-work`** for picking up where a
session left off, **`contribute`** for the PR workflow, **`add-adapter`** for the authoring
loop. See `.claude/skills/README.md` for how they are picked up and where the boundary
between a skill and a spec sits. Contributors using other agent tools get the same routing
through `AGENTS.md`, which symlinks here.

## Writing conventions

**No AI attribution.** No `Co-Authored-By: Claude` trailer, no "Generated with" footer, no
bot signature in PR bodies, issues or comments. Commits carry the repo owner's identity;
this is a public repo under one person's name.

**Short.** Reviewers skim, and length hides the important line rather than adding weight to
it — the same reason `state.md` has a 50-line cap.

| Artifact | Target |
|---|---|
| Commit subject | Conventional Commits, ≤72 chars. Body only when the *why* is not obvious |
| PR body | Follow `.github/PULL_REQUEST_TEMPLATE.md`. Usually under 15 lines |
| **PR size** | **Under ~400 changed lines.** See below |
| Changeset | One sentence, user-facing |
| Issue reply | Answer first. Context only if asked |
| Docs | No preamble, no "in this section we will" |

**Keep PRs small.** Review quality falls off a cliff past a few hundred lines — a 4,000-line
PR does not get reviewed, it gets approved. Split by the seam that makes each half
independently verifiable: one package, one command flipped from stub to implemented, one
doc's decisions.

The scaffold PR was the deliberate exception and should stay the only one: its parts
reference each other, so every intermediate state is a repo where `pnpm install` or
`pnpm typecheck` is red for a structural reason. If you think you have a second exception,
you probably have two PRs.

The command manifest makes splitting cheap — a PR that flips exactly one entry from
`not-implemented` to `implemented` is self-describing, and `repo:check` proves it landed.

## Account boundary

This is a personal project. **Nothing touches a Bemlo account, org or credential**, and
`~/Projects/infra` is off limits entirely — it is Bemlo GCP Terraform, not a pattern source.

`gh` is authed as an account with write access to the `bemlo` org, so every `gh repo create`,
`gh api` and `gh pr` names `proxlane/…` explicitly, never a bare repo name.

Git identity is set per-directory via `includeIf`: this repo commits as
`8323210+scarsam@users.noreply.github.com` so no real address enters public history.

## What must never enter this repo

It is going public, and git history is not retractable. Beyond the obvious secrets:

- **Infrastructure specifics** — IPs, hostnames, `/root/` paths, applicationIds, port maps,
  capacity numbers. Generic operating guidance is fine and useful; the box's coordinates are
  a reconnaissance package. Cross-reference the private runbook instead.
- **Commercial terms** — affiliate rates, negotiating posture, named provider contacts.
- **Third-party personal data**, including anyone's email but the maintainer's.
- **Named commercial scraping targets**, per `plan.md` section 19's interim default.
- **Internal financial analysis** — margin figures, kill triggers, entity status.

## Agents

Briefs are in `.claude/agents/`, one file each; the harness lists them. Ownership is the
table above, not the brief.

- `adapter-engineer`, `platform-engineer` and `data-engineer` can run in parallel.
- `security-engineer` reviews the others' PRs and has no write tools.

**Spawn a subagent only when the work is genuinely parallel *and* context-isolated.** In
phase 1 that is four cases: three adapters at once, fixture recording, SEO page writing,
and the security pass on a security-touching diff. Everything else is cheaper in one
session, because a subagent that needs the parent's context pays to rebuild it.

**Agent spend ceiling: EUR 150/month**, reviewed monthly against `plan.md` section 17's
own rule — if it breaks the budget, the ceiling was set wrong, not the work.

## House rules

- Conventional Commits, enforced. Every behaviour change carries a changeset — **including
  `apps/gateway`**, which is `private: true` but versioned: `.changeset/config.json` sets
  `privatePackages: { version: true, tag: false }`, so it gets a CHANGELOG and never a
  publish. Before that, ten gateway-only changesets named `@proxlane/shared` instead, because
  naming the package that actually changed was impossible.
- **A new subsystem ships with its `proxlane doctor` checks in the same PR.** `operating.md`
  B9 already says every support question that takes more than one exchange becomes a check;
  health, cooldowns and Valkey shipped without any, and the first question they produced was
  one `doctor` could not answer.
- Docs update in the same PR as the API change. A decision goes into the doc it changes,
  in the same commit — there is no separate decisions log.
- No secrets in fixtures. The record script sanitizes; CI scans.
- Never hand-write a fixture. CI cannot tell a recording from a fabrication, so this one
  is on you.
- Provider defaults never leak: adapters set every parameter explicitly.
- The hot path never writes synchronously to Postgres — **except hosted billing**, which
  must not be lost in a batch. See `operations.md` section 2.
- Affiliate rate is never an input to routing or rankings.
- The README describes shipped behaviour only.

## Current status

**Public since 2026-08-10.** Phase 1 shipped: three adapters, the gateway, the edge guard,
the detector, 18 of 25 commands real. `main` carries a ruleset with no bypass actor, so
blocking CI binds on the maintainer too.

`pnpm repo:check` is what is built. **See `docs/state.md`** for what is in flight and what
is waiting on an owner decision; it is printed at session start.
