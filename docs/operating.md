# Proxlane: Operating Manual

How the project is actually run week to week. `plan.md` says what to build,
`integrations.md` and `operations.md` say how it works. This says who does what, on
what rhythm, and by what rules.

Two people, a few hours a day. Every process here is designed to survive being
skipped for a week without rotting.

---

# Part A — Running SEO and marketing

## A1. The operating principle

We do not do content marketing. We do documentation that happens to rank, and data
publishing that happens to be interesting. Every page must be the best available
answer to a question a scraping engineer actually types, or it does not ship.

The test before writing anything: *would this page be worth publishing if search
engines did not exist?* If no, it is filler and filler is what makes a site look like
every other AI-written dev blog.

## A2. Page inventory and ownership

Four families, in priority order. Everything lives in the repo as MDX and ships
through a PR, same as code.

| Family | Count at launch | Generated or written | Refresh |
|---|---|---|---|
| Migration pages | 4 | written from adapter param tables | when a provider's API changes |
| Comparison pages | 4 | written, data from scoreboard | quarterly |
| Provider pages | 6 to 20 | generated from adapter registry | automatic on adapter change |
| Docs | ~15 | written | on every API change, same PR |
| `/targets/<domain>` | 0 at launch, then automatic | generated from scoreboard | per canary cadence, B6 |
| Symptom pages | 4 at launch | written | annually |

**Symptom pages** are the agent-facing ones from `plan.md` section 16: "403 while
scraping", "200 response with a captcha page", "Cloudflare challenge in Playwright",
"DataDome block detection". Highest intent in the funnel, because they are read
immediately after something broke.

**Generated pages are code.** Provider pages render from the adapter registry, target
pages from the scoreboard. Nobody hand-writes them, nobody hand-updates them, and
adding an adapter publishes a page as a side effect. If a generated page needs a
human edit, the fix goes in the generator.

## A3. Weekly rhythm

Two hours, one sitting, same day each week.

| Cadence | Task |
|---|---|
| Weekly | one written page ships (symptom, guide, or comparison refresh) |
| Weekly | check Search Console: new queries, pages losing impressions, coverage errors |
| Weekly | reply to every open GitHub issue and Discord thread |
| Weekly | 30 minutes reading r/webscraping, Scrapy and Crawlee Discords, HN. Answer questions, mention nothing |
| Monthly | scoreboard data post: what changed in provider success rates. This is the only "content marketing" we do, and it is a data release |
| Monthly | review affiliate dashboards against our own referral counts |
| Quarterly | prune or rewrite the worst-performing five pages rather than adding five more |

The 30 minutes of reading without promoting is not optional and it is not a growth
tactic. It is how you learn which targets are breaking this month, which becomes the
next symptom page, which is the thing that ranks.

## A4. Publishing workflow

1. Idea captured as a GitHub issue labelled `content`, with the query it targets.
2. Draft as MDX in `apps/web/content/`, PR opened.
3. Checklist enforced by the PR template: one clear query, a real answer above the
   fold, code that runs, no claim without a source or our own data, affiliate
   disclosure if links are present, internal links to two related pages.
4. Merge deploys. No CMS, no scheduling, no separate marketing stack.

Content in the repo means content gets reviewed like code and never drifts from what
the product does.

## A5. Measurement

Free stack only, until revenue: Google Search Console, Bing Webmaster Tools, a
self-hosted Umami or Plausible on the existing box, and GitHub's own traffic tab.

Track four numbers, monthly:

- Signups and self-host pulls (ghcr) attributable to a landing page
- Affiliate clicks and conversions per provider page
- Impressions and clicks by page family, so we learn which family compounds
- GitHub stars, but as a vanity check on launch impact only, not a target

Do not build a dashboard for this in year one. A spreadsheet updated monthly is
correct.

## A6. Editorial rules, non-negotiable

- **Never disparage a provider.** They are our partners, our affiliate income, and
  our routing targets. Comparison pages state measured facts and let them stand.
- **Every ranking is generated from measured data.** Affiliate rate is never an input.
  Stated in the docs, and the scoreboard is public so anyone can verify.
- **Disclose affiliate links on every page that carries one**, in plain language, near
  the link and not in a footer.
- **No claim we cannot reproduce.** Benchmarks published with method and date, or not
  published.
- **No AI-written filler.** Drafting help is fine; shipping something nobody read is
  not.

## A7. Backlinks, the legitimate kind

- Listings: openalternative.co, alternativeto.net, awesome-web-scraping,
  awesome-selfhosted (the self-host story qualifies us), MCP server directories.
- One real case study using our own project as the customer, with numbers from the
  dashboard. Published once, linked once, never repeated.
- Answering questions where the answer happens to be us, sparingly, disclosed.

Explicitly not: cross-linking our own low-authority sites into a network. It passes
no authority and it is the exact shape of a link scheme, with the risk landing on the
properties that already earn money.

---

# Part B — Running the open source project

**Part B is in force.** The repo went public on 2026-08-10, which was the gate.

The gate existed because applying all of Part B to a solo maintainer on a greenfield
monorepo would have put five checkboxes, a changeset, same-PR docs, conformance, a CLA
bot, blocking CI, a security review and an RFC in front of one person, protecting
external contributors who did not exist. They can exist now, so it applies.

What that switched on, and what actually enforces it:

| | Enforced by |
|---|---|
| Blocking CI, all of B6 | the `main` ruleset requires `ci-complete` and `title`. No bypass actor, so it binds on the maintainer too |
| PR before merge, squash only, linear history | the same ruleset |
| Secret scanning and push protection | GitHub, repo settings |
| Private vulnerability reporting | `SECURITY.md`, 72h acknowledgement |
| The 48-hour issue SLA | B4, and nothing but attention |

## B1. What the license buys and what it costs

AGPL-3.0-only for the gateway, web app and CLI; Apache-2.0 for `sdk`, `adapters`,
`detect` and `shared`. The
copyleft protects the hosted business; the permissive licence removes hesitation from
anyone integrating.

**CLA, via cla-assistant, decided — for the right reason.** The stated reason used to be
that enterprise self-host deals require non-AGPL terms. That is a misreading: AGPL
section 13 triggers on *offering the software to others over a network*. A company
self-hosting Proxlane to run its own scraping owes nothing and needs no commercial
licence. The buyers who genuinely need one are the buyers who want to resell it.

The real reasons to hold a CLA are relicensing optionality and the open-core `ee/` shape
that llmgateway uses, which is worth deciding before the first external PR because
retrofitting means chasing every contributor. Set against that is a real cost: the CLA
taxes exactly the drive-by adapter PRs that section 8's month-6 criterion depends on. It
is a close call made deliberately, not an obvious one. Say the real reason in
CONTRIBUTING; developers accept a reason and resent a surprise.

**The adapter kit *is* `packages/adapters`** — no separate package — and it is Apache-2.0
alongside `sdk`, `detect` and `shared`. It is the part
we most want strangers to write. The licence split previously covered the gateway, web,
SDK and kit, leaving adapters unassigned.

## B2. Repo furniture

Present before the repo goes public. A repo missing these reads as abandoned no
matter how good the code is.

```
README.md              what it is, one-line migration, quickstart, self-host
CONTRIBUTING.md        setup, the adapter guide, PR expectations
CODE_OF_CONDUCT.md     Contributor Covenant, with a real contact address
SECURITY.md            disclosure process, 90-day policy, contact
LICENSE                AGPL-3.0
AGENTS.md              how agents should work in this repo
.github/
  ISSUE_TEMPLATE/      bug, adapter request, provider drift, content
  PULL_REQUEST_TEMPLATE.md
  workflows/           see B6
  CODEOWNERS
  FUNDING.yml
```

## B3. Branching and commits

- `main` is always releasable. No long-lived branches, no develop branch.
- Short-lived feature branches, squash merge, branch deleted on merge.
- **Conventional Commits**, enforced by CI, because Changesets and the changelog
  depend on it:

```
feat(adapters): add zyte adapter
fix(gateway): respect global deadline on redirect chains
docs(migration): add scrapingbee param mapping table
chore(deps): bump undici to 8.x
```

Scopes match package names. `feat!` or a `BREAKING CHANGE:` footer for anything
altering the public request surface.

- Every PR that changes behaviour includes a changeset. CI fails without one.

## B4. Issues

**Labels, kept small.** A taxonomy nobody can hold in their head goes unused.

```
type:      bug · feature · adapter · docs · content · security
area:      gateway · adapters · detect · web · infra
status:    needs-triage · confirmed · blocked · wontfix
flag:      good-first-issue · help-wanted · provider-drift
```

**Triage rhythm.** Every issue gets a human response **within 48 hours**. That clock
started 2026-08-10 when the repo went public and issues began arriving from strangers.
Unanswered issues are the single clearest signal that a project is dead, and
the fix costs minutes — but a 48-hour SLA is destroyed by definition by this document's
own promise that every process here survives being skipped for a week.

**Provider drift issues are special.** The canary opens them automatically,
labelled `flag:provider-drift`. These jump the queue: a broken adapter is a broken
product for anyone routing through that provider.

**No stale bot.** Auto-closing issues is a way of lying about the backlog and it
insults the person who reported. Close deliberately with a reason, or leave it open
and honest.

## B5. Pull requests

PR template checklist:

- [ ] tests added or updated, and they are not mocks of our own code
- [ ] changeset included
- [ ] docs updated in the same PR if the public surface moved
- [ ] conformance green if an adapter changed
- [ ] no secrets, no fixtures containing live keys

Review rules: every PR reviewed by a maintainer, including our own. External adapter
PRs are judged almost entirely by whether conformance passes, which is the point of
having built it. Merge within a week or say why, because a stalled first PR is a
contributor lost permanently.

First-time contributors get a real reply, not a bot greeting: what is good, what
needs changing, and roughly when it will merge.

## B6. CI jobs

On every PR, all blocking:

| Job | Runs |
|---|---|
| `typecheck` | tsc across the workspace |
| `lint` | Biome, fails on diff |
| `test:unit` | pure translate/parse and detect tests |
| `test:contract` | replay transport against recorded provider traffic |
| `test:e2e` | testcontainers Postgres and Redis, full gateway |
| `conformance` | every adapter against the shared suite |
| `changeset` | fails if behaviour changed without one |
| `secrets` | scan diff and fixtures for key-shaped strings |
| `build:docker` | amd64 image build, not pushed. arm64 builds in the release workflow on a native runner, never here — QEMU breaks the ten-minute rule |
| `security-review` | **conditional**, not on every PR: runs when the diff touches `packages/adapters/**`, `apps/gateway/**`, anything referencing `provider_keys`, env parsing, SQL, or `.github/workflows/**` |

Scheduled:

| Job | Cadence | Action on failure |
|---|---|---|
| `canary:live` | **weekly at launch, nightly once revenue exists.** This is the one definition of canary cadence; every other doc references it | opens a `provider-drift` issue tagged with the provider |
| `cost-drift` | weekly | issue if reported cost diverges from our table by >10% |
| `record:diff` | weekly | uploads a diff artifact when recorded responses change |
| `deps` | Renovate, weekly | auto-merge patch, PR for minor and major |

CI must stay under ten minutes or people stop running it locally and start pushing to
see what happens.

## B7. Feature workflow

Once the repo is public: anything that crosses package boundaries, changes the public
request surface, or adds a persisted table gets a short RFC first. Before then the
trigger applies only to proposals from outside the two maintainers, because in a fresh
monorepo every other PR would trip it. The RFC is: an issue with `type:feature`, containing the
problem, the proposed shape, what it rules out, and a rejected alternative. Half a
page, not a document. Discussion happens there, and the PR references it.

Everything else goes straight to a PR. The point of the RFC is to avoid a contributor
spending a weekend on something we would decline, not to add ceremony.

Roadmap lives as a GitHub Project board with three columns: now, next, someday. Public,
so nobody has to ask.

## B8. Releases

- Changesets accumulate on `main`, and a release PR is opened automatically.
- Merging the release PR publishes: npm packages **with provenance**, a git tag, a GitHub
  Release with generated notes, and multi-arch Docker images to ghcr tagged `:x.y.z` and
  `:latest`.
- **The tag is annotated, not GPG-signed.** This said "signed" before the workflow existed,
  and signing needs a key the repo does not have and a decision about where it lives. npm
  provenance is the attestation that actually ships: it links each tarball to the commit and
  the workflow that built it, signed with the workflow's OIDC identity rather than a stored
  secret. Revisit tag signing when there is a key to sign with.
- **The npm token expires every 90 days**, which is npm's cap on automation tokens and the
  right trade — the cost is rotation, not exposure. The release workflow proves the
  credential before it versions anything, so expiry fails as a clear message rather than as a
  half-finished release with `main` claiming a version the registry does not have. Mint a
  granular token scoped to `@proxlane` plus the unscoped `proxlane` package, read and write,
  **no organisation access** — org permission manages members and settings and publishing
  does not need it.
- **Provenance validates `repository.url` in the published manifest.** Every publishable
  package declares `repository` with a `directory`, and `release:dry` fails without it. This
  is not decoration: 0.1.0's first publish attempt was rejected `E422` on all four packages
  for a missing field, *after* the signed attestation had already reached Sigstore's public
  transparency log. The rejection is not retryable in place, only in a new run.
- **Never merge an empty changeset to `main`.** `changesets/action` takes the `version`
  branch whenever any changeset exists, logs `All changesets are empty; not creating PR`,
  and exits 0 without publishing. Green run, no release PR, nothing shipped. It cost 0.1.0 a
  release cycle. `--empty` is fine on a branch and a handbrake on `main`.
- **OIDC trusted publishing is reachable on the current pins**, and the mechanism is worth
  stating because it is not obvious. `changeset publish` spawns `pnpm publish`, pnpm rewrites
  `workspace:*` into real versions and stages the result, then hands off to the npm CLI —
  which is what performs the OIDC exchange. pnpm 10 contains no OIDC code of its own. So the
  property we need comes from *both* halves: pnpm for the rewrite, npm for the credential.
  Publishing through `npm` alone leaves `workspace:*` verbatim and the tarball is
  uninstallable, which is how `proxlane@0.0.0` shipped.
- **That is why the pnpm pin is load-bearing beyond the catalog.** pnpm 11.0.x reimplemented
  publish natively, dropped the npm delegation, and broke OIDC publishing outright
  ([pnpm#11513](https://github.com/pnpm/pnpm/issues/11513)); it was repaired in 11.0.7. A
  mechanical bump across that boundary changes how publishing authenticates.
- **Trusted publishers are configured** on all five publishable packages, each bound to
  `release.yml` in `proxlane/proxlane` with publish permission. Inspect with
  `npm trust list <pkg>`; note `npm trust` needs npm >= 11.10, so use the Node 24 pin's npm
  rather than whatever the shell resolves.
- **The binding is to the workflow FILENAME.** Renaming `release.yml` breaks it silently, and
  publishing falls back to the token rather than failing. `repo:check` assertion 22 keeps the
  file existing under that name because `CLAUDE.md` owns the literal path.
- **A green release is not evidence OIDC was used**, because npm falls back to the static
  token whenever the exchange fails. `scripts/verify-trusted-publish.ts` runs after every
  publish and reads back what the registry recorded, so the release fails loudly on a
  credential regression even though the packages went out fine. The signal is
  `_npmUser.trustedPublisher` in the **full** packument, which is what pnpm's own
  `trustPolicy` reads; `npm view <pkg> _npmUser` renders it as a string and the abbreviated
  packument omits it, so neither can answer this.
- **`NPM_TOKEN` stays until one release proves the exchange.** It is the fallback that makes
  configuring trusted publishing safe. Delete it once the verify step has passed once, and
  remove the credential preflight in the same PR: with no token, a preflight that demands one
  would block releases that no longer need it.
- Semver honestly. A changed default in an adapter is a breaking change even if the
  types did not move.
- Release cadence: whenever the release PR has something worth shipping, at most
  weekly. Not scheduled, not held back for a "big" release.
- The self-host compose file pins a version. `:latest` exists but is documented as
  the unstable choice.

## B9. Support boundaries, stated out loud

Community support is best-effort through GitHub issues and Discussions — not Discord, which
B10 rejected because the whole growth model is search and a chat server is invisible to it.
Paid support is the enterprise tier. Say this in the README rather than quietly
disappointing people.

`proxlane doctor` exists so that most support requests answer themselves: it checks env,
provider key presence, egress, where routing state lives, whether the replica count matches
that backing, which of health and cooldowns are on, and whether a configured Valkey is
reachable — printing a shareable diagnostic with secrets redacted. Postgres joins the list
with the schema that needs it. Every time a support question
takes more than one exchange, the fix is a new check in `doctor`, not a longer reply.

## B10. Community

- Discord with four channels only: announcements, help, adapters, general. More
  channels than people is a graveyard.
- Founders answer publicly, in the open, including "no" and "not soon".
- Contributors who land two meaningful PRs get commit access to their area and a line
  in the README. Ownership is cheaper than gratitude and works better.
- Never argue with a hostile comment on HN or Reddit. Answer the technical question in
  it, ignore the rest.

---

# Part C — Agent briefs

Agent briefs live in `.claude/agents/`, one file each. Ownership of every path is the
table in `CLAUDE.md`. Neither is duplicated here, for the same reason `operations.md`
section 8 no longer duplicates them: the copies drifted, and telling each agent to write
decisions back into this file turned a manual into an append-only log that every agent
paid to read. Decisions go into the doc they change, in the same commit; `git log` is the
dated audit trail.
