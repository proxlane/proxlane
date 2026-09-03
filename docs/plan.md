# Proxlane: Build Plan

Open source scraping proxy gateway. ScrapeOps' product, llmgateway's distribution model.
One endpoint in front of every scraping API provider: automatic failover, cost routing,
BYOK free forever, self-hostable, credits with a flat fee.

Working thesis: ScrapeOps proved the demand ($9-249/mo plans, 20+ providers integrated).
llmgateway proved that an open source, BYOK-free, self-hostable challenger can pull users
from a closed incumbent (OpenRouter) with a tiny team. Nobody has combined the two.

---

## 1. What we learn from, and from whom

Moved to `docs/archive/strategy.md` — read-once. What it decided is now stated where it
applies: the pricing triad and licence split in `CLAUDE.md`, the page families in
section 6, the ScrapeOps feature parity in section 2. The archive also carries three
corrections to what that section originally claimed, including the affiliate rates that
section 7 now states properly.

---

## 2. Product Spec

### Modes

1. **BYOK (free forever).** User stores their provider API keys (encrypted) in our
   dashboard. Requests route on their accounts. We never touch money. Revenue: affiliate.
2. **Hosted credits (phase 3).** Stripe top-ups, requests run on our master provider
   accounts, charged at provider cost + 5% flat fee, pay per successful request only.
3. **Self-host (free forever).** `docker compose up`. Their infra, their keys, no
   phoning home. Optional opt-in: share anonymized per-domain routing stats, receive
   the community routing table in return.

### Request lifecycle

```
Client -> GET https://api.proxlane.dev/v1?api_key=GW_KEY&url=https://target.com&render=true
  1. Auth GW_KEY -> account, plan, provider keys
  2. Parse params (ScraperAPI-compatible names)
  3. Route: pick provider from per-domain scoreboard (MVP: static priority list)
  4. Adapter translates request -> provider API call with user's provider key
  5. Response validation:
       - HTTP status sanity
       - soft-block heuristics (captcha markers, consent walls, challenge pages,
         suspicious short bodies, provider-specific error shapes)
  6. On failure -> cooldown that provider for that domain, retry next in chain
     (max N attempts, configurable, default 3)
  7. Log one row per attempt: domain, provider, latency, outcome, estimated cost
  8. Return body + headers: X-Outcome, X-Provider-Used, X-Attempts, X-Detect-Rule,
     X-Cost-Estimate
```

### Supported params, v1 (ScraperAPI-compatible surface)

| Param | Meaning |
|---|---|
| `api_key` | gateway key |
| `url` | target URL (required) |
| `render` | JS rendering (routes only to providers that support it) |
| `country_code` | geotargeting |
| `premium` | force residential/premium tier |
| `session_number` | sticky session (best effort per provider) |
| `keep_headers` | pass through custom headers |
| `provider` | force a specific provider (escape hatch, also great for benchmarking) |
| `timeout` | global deadline in seconds, default 120, max 180 |

`timeout` is not optional to add: `GatewayRequest.deadlineMs` is required by the adapter
contract, and without this param there was no way for a client to set it.

Also accept POST with JSON body for the same fields. Publish an OpenAPI spec.

### Launch adapters (3, then grow)

1. **ScraperAPI** - biggest brand, simplest API, generous trial, affiliate program.
2. **ScrapingBee** - popular with indie devs, clean REST API.
3. **Scrapfly** - strong anti-bot, good docs, dev-friendly.

Phase 2/3 additions: Zyte API, Bright Data Web Unlocker, Oxylabs Web Scraper API,
ScrapingAnt, Scrape.do, ScrapingFish. Each adapter: one file, translate-in/translate-out,
capability flags (render, geo, sessions), cost table, error mapping. Target ~150-250
lines each. An adapter contribution guide makes these community-buildable.

### Soft-block detection (the credibility feature)

Heuristics engine, ships v1 with:
- Known challenge fingerprints: Cloudflare, DataDome, PerimeterX, Akamai, Kasada
  (title/body/script markers, cookie names)
- CAPTCHA markers (recaptcha, hcaptcha, turnstile DOM signatures)
- Consent/paywall shells with near-empty content
- Body length anomaly vs. rolling median for that domain
- Provider-specific "success but actually failed" response shapes

Every rule has an ID, and responses report which rule fired. Users can override per
domain. This engine improves forever and is a real differentiator vs. dumb proxying.

**It is NOT a differentiator against the one real competitor.** ScrapeOps ships "Response
Validation" on every premium plan, so soft-block detection is table stakes in this category
rather than novel — an earlier version of this section read as though nobody else did it.
What is actually ours is that it is *inspectable*: a rule ID on every response, a per-attempt
cost breakdown, and per-domain override. Better and auditable, not new.

### Routing scoreboard (phase 3, the moat)

Per (domain, provider): rolling success rate, p50/p95 latency, cost per success.
Route = cheapest provider above success threshold; explore alternatives with small
epsilon to keep data fresh. Hosted traffic feeds it. Self-hosters get the community
table via opt-in sync. This is the dataset ScrapeOps has and no one else publishes.

---

## 3. Architecture and Stack

### Monorepo

The layout is in `CLAUDE.md`, which is auto-loaded and is the single authority, together
with the owner of every path. It is not repeated here: the copy that used to live in this
section had already drifted from it on `packages/shared` and on which services the compose
file runs.

### Libraries (pin these, all TypeScript)

| Concern | Choice | Notes |
|---|---|---|
| Gateway HTTP | Hono | fast, middleware-friendly, you know it |
| Runtime | Node LTS | decided over Bun, see below; major pinned in `CLAUDE.md` |
| Web framework | TanStack Start | SSR for SEO pages, SPA dashboard |
| Client data | TanStack Query | dashboard data fetching |
| RPC | oRPC | typed contract in /packages/api |
| ORM | Drizzle + drizzle-kit | Postgres |
| DB | Postgres | one instance, both apps; version pinned in `CLAUDE.md` |
| Cache/state | Valkey (ioredis client) | provider cooldowns, rate limits, scoreboard hot data; version pinned in `CLAUDE.md` |
| Auth | Better Auth | email, plus GitHub and Google OAuth, with account linking on a verified email. Organization plugin for tenancy. `operations.md` §5 |
| Validation | Zod | params, env, adapter IO |
| Encryption | libsodium-wrappers | provider keys encrypted at rest, key from env |
| Queue (later) | BullMQ | async jobs: usage rollups, affiliate webhooks |
| Payments (ph.3) | Stripe | credits top-up + customer portal |
| Email | Resend or SES | transactional only |
| Logging | pino | structured; ship to Grafana/Loki on the VPS later |
| Testing | Vitest | adapters and /detect need real fixture-based tests |
| Monorepo | pnpm + turborepo | same as llmgateway |
| UI primitives | Base UI | headless, no visual defaults; tokens are ours |
| Styling | Tailwind v4 | CSS-first tokens in `@theme`, no default palette |
| Tables | TanStack Table | headless, the request log is the core surface |
| Charts | visx | Recharts has a recognizable silhouette; dashboard is chart-heavy |
| Lint/format | Biome | one tool, fast |

### Runtime: Node, not Bun

Bun is faster at the things this project does not care about (cold start, bundling,
test runner speed) and weaker at the one thing it lives or dies on: fine-grained
outbound HTTP control.

The gateway is a proxy. It needs per-origin connection pools, explicit
`headersTimeout` and `bodyTimeout`, connect timeouts, keep-alive tuning, and
interceptors, all set differently per provider. ScraperAPI holds a connection for up
to 70 seconds while it retries internally; ScrapingBee fails fast. Node's undici
exposes every one of those knobs as a first-class API. Bun's fetch does not expose an
equivalent surface, so we would be reimplementing a client instead of configuring one.

Secondary reasons, each individually survivable but additive: testcontainers,
pgbouncer, pino, and BullMQ are all Node-first and battle-tested there; self-hosters
running arbitrary hardware get a more predictable runtime; and long-lived connections
with large buffered bodies are exactly the workload where the mature runtime is worth
more than the fast one.

Do not split runtimes. Bun as a package manager or test runner alongside Node in
production adds a second set of resolution and compatibility edge cases for no gain.
One runtime, everywhere, including CI and the Docker images.

Revisit only if a measured bottleneck points at the runtime, which for an I/O-bound
proxy it almost certainly will not.

### Data model (v1 sketch)

**`user`, `session`, `account`, `verification`, `organization`, `member` and `invitation`
are NOT in this sketch, and must not be hand-written.** Better Auth generates the first four,
and its organization plugin generates and owns the last three. Writing an `orgs` table beside
a plugin that creates `organization` is a collision, not a sequencing problem. See
`operations.md` section 5 for the org and permission model this repo settled on.

```
gateway_keys     id, org_id, created_by, key_hash, name, created_at, last_used_at
                 (created_by is the only route to per-member log scoping later,
                  since requests attribute to the key and never to a user)
provider_keys    id, org_id, provider, ciphertext, nonce, label, status
requests         id (uuidv7), org_id, domain, url_hash, outcome, provider_used,
                 attempts, total_latency_ms, cost_micro_total, created_at
                 (partitioned by WEEK from day one; this table gets big)
request_attempts request_id, seq, provider, outcome, detect_rule, upstream_status,
                 latency_ms, cost_micro, cost_source, started_at
                 (same partition key as requests; the scoreboard's real source)
domain_stats     domain, provider, window_start, window_len, successes, failures,
                 latency_hist int[], cost_sum
ledger_entries   id, org_id, kind, amount_micro, request_id, snapshot jsonb, created_at
affiliate_clicks org_id, provider, clicked_at, converted_at
```

Store `url_hash` not full URLs by default (privacy posture, and a selling point).
Full-URL logging is per-org opt-in for debugging.

Four things in that sketch were wrong or missing, and all four are load-bearing:

- **`request_attempts` exists.** A `requests` row records only the winner, so a losing
  provider's block on a domain — the dataset `/targets/` pages and cost routing are built
  from — was not queryable. See `integrations.md` section 5.
- **`domain_stats` stores a histogram, not p50/p95 scalars.** Percentiles do not compose:
  you cannot roll five-minute p95s into a 24-hour or 7-day p95, and every routing
  decision wants the longer window. A fixed log-bucket histogram (`int[]`, bucket edges
  documented next to the column) merges by array addition, needs no Postgres extension,
  and yields any percentile at read time.
- **IDs are uuidv7, generated in-process.** `operations.md` section 2 batches request
  writes, so rows must be referenceable — by an attempt, by a ledger entry — before they
  land. A serial primary key makes batching impossible.
- **Weekly partitions, not monthly.** Retention is 30 and 90 days (`operations.md`
  section 3), which monthly partitions can never align with, and the retention job's
  "drop expired request rows" `DELETE`s from a partitioned table, defeating the point of
  partitioning it.

**drizzle-kit cannot express declarative partitioning.** It generates no
`PARTITION BY RANGE`, and it will diff against partitions it does not model — under a
rule that forbids `db push` in CI, that produces migrations nobody wants. `requests` and
`request_attempts` DDL is therefore **raw SQL, excluded from the drizzle-kit diff**; the
rest of the schema stays generated.

### Deploy (existing Hetzner + Dokploy)

- Dokploy apps: `gateway`, `web`, `worker`, `postgres`, `valkey`. Gateway gets the api
  subdomain. Same five services as the self-host compose; see `CLAUDE.md`.
- Start on the current VPS. When hosted traffic grows, move gateway to its own CX
  instance; the proxy hot path should not share CPU with cron scrapers.
- Backups: nightly pg_dump to object storage (Hetzner or R2). Non-negotiable before launch.
- Status page: Uptime Kuma on the VPS or a hosted checker, public from day one.
- Metrics: requests/sec, success rate, per-provider error rate. pino -> Loki -> Grafana,
  or start with a simple internal /metrics page. Do not overbuild week one.

---

## 4. API Examples (write these into docs before writing code)

Basic:
```bash
curl "https://api.proxlane.dev/v1?api_key=KEY&url=https://example.com"
```

JS rendering + geo:
```bash
curl "https://api.proxlane.dev/v1?api_key=KEY&url=https://example.com&render=true&country_code=de"
```

Force provider (benchmarking):
```bash
curl "https://api.proxlane.dev/v1?api_key=KEY&url=https://example.com&provider=scrapingbee"
```

Node, migration from ScraperAPI (this snippet goes on the migration page):
```js
// before
const r = await fetch(`https://api.scraperapi.com?api_key=${KEY}&url=${url}`);
// after: one hostname change, keys and params unchanged in shape
const r = await fetch(`https://api.proxlane.dev/v1?api_key=${GW_KEY}&url=${url}`);
```

Response headers:
```
X-Provider-Used: scrapingbee
X-Attempts: 2
X-Detect-Rule: none
X-Cost-Estimate: 0.00049
```

Python and cURL versions of everything. Docs framework: Fumadocs or Starlight, prerendered.

---

## 5. Phase Plan

### Phase 0 - Validation and setup (this week, parallel with coding)

- [ ] Post concept in r/webscraping: "open-source ScrapeOps: BYOK, self-host, no markup.
      Would you use it? What providers must be in v1?" The answers pick adapter #4-6.
- [ ] Email affiliate teams: Smartproxy/Decodo, ScraperAPI, ScrapingBee, Scrapfly.
      Question: do gateway-referred signups qualify for recurring commission? Get it in writing.
- [ ] Register domain + GitHub org. Reserve X/Twitter handle, Discord server.
- [ ] Sign up for trial accounts at the 3 launch providers, capture fixture responses
      (success, block, captcha, timeout) for the /detect test suite.

### Phase 1 - MVP (weeks 1-4)

Week 1: monorepo scaffold, db schema + migrations, Better Auth, gateway skeleton with
auth middleware, ScraperAPI adapter end to end against real fixtures.
Week 2: ScrapingBee + Scrapfly adapters, failover chain with Redis cooldowns,
/detect v1 with fixture tests, request logging.
Week 3: dashboard v1 (keys CRUD, provider keys CRUD with encryption, requests table,
success/latency/cost per domain per provider), oRPC wiring.
Week 4: docker compose self-host path polished (single command, seeded admin),
docs site with quickstart + 3 provider guides, deploy hosted version on Dokploy,
status page live, invite 5-10 beta users from the Phase 0 thread.

Definition of done: `pnpm selfhost:smoke` and `pnpm conformance` both green — a stranger
self-hosts in under five minutes, and a request survives one provider failing over to
another. The full launch gate is `operations.md` section 9.

### Phase 2 - Launch (weeks 5-8)

Week 5: landing page (structure stolen from llmgateway section by section: hero with
one-line-change code, uptime math, pricing triad, provider logos, FAQ).
Week 6: SEO batch 1 (see section 6): 3 migration pages, 3 comparison pages,
6 provider pages. Prerendered, real meta, sitemap.
Week 7: README to showcase quality (architecture diagram, GIF demo, badges),
CONTRIBUTING + adapter guide, seed Discord, line up 3-5 beta users as social proof.
Week 8: launch. Show HN ("Show HN: Open-source ScrapeOps alternative - BYOK, self-host"),
r/webscraping, r/selfhosted, r/SideProject, X thread. Founder answers every comment
for 48h. Affiliate links live in the connect-provider flow.

### Phase 3 - Monetize and moat (months 3-6)

- Stripe credits + master accounts at 2-3 providers. Per-success billing with domain
  multipliers. Gate high-risk domains (LinkedIn etc.) on hosted mode; BYOK unrestricted.
- Routing scoreboard live; epsilon-greedy exploration; community routing table sync
  for opted-in self-hosters.
- Adapters to 8-10. Residential proxy port (HTTP CONNECT) as product #2.
- MCP server: `fetch_page` tool so agents (Claude, Cursor) use the gateway natively.
  Small build, rides the largest demand wave in scraping right now.
- SEO batch 2: programmatic pages (section 6).

**Candidate, not committed: a crawl/job API.** Recorded 2026-08-07 because the argument is
better than it first looks, and because the alternative is rediscovering it later.

Firecrawl's `/crawl` returns a job id you poll. Investigating whether it fit the adapter
contract (`integrations.md` section 9 — it does not, and it never blocked anything) surfaced
the inverse question: *a crawl routed across providers is something no single provider can
sell.* Easy pages on the cheapest adapter, hard pages failing over to the expensive one,
per-page outcomes and cost in one job — that is the routing moat applied to a unit of work
larger than one request. A provider structurally cannot offer it, which is the same argument
section 9 already makes about routing generally.

It is also **product #2**, and section 9's scope-creep rule is explicit: *no product #2
before first revenue.* It needs job persistence, its own billing grain (per page? per job?),
its own failure semantics, and a webhook surface — none of which the gateway's global
deadline and per-attempt budgets have any meaning for.

So: not now, not phase 3 by default. Revisit **after hosted credits have revenue**, and
only if per-request routing has actually proven the moat it claims. If it is built, the
honest shape is a separate service that consumes the gateway, not a widening of
`GatewayRequest`.

---

## 6. SEO and Content Plan (the growth engine, treat as product)

ScrapeOps itself is proof: their site is a proxy-comparison content farm funneling into
their aggregator. We run the same play with an open source trust advantage.

### Page types, priority order

1. **Migration pages** (buy-intent, low competition):
   "Migrate from ScraperAPI", "... ScrapingBee", "... ScrapeOps", "... Scrapfly".
   Each: 1-line base URL change, param mapping table, what improves (failover, analytics).
2. **Comparison pages**: "<us> vs ScrapeOps", "ScraperAPI vs ScrapingBee vs Scrapfly
   (and how to use all three)". The triple-comparison angle is unique to an aggregator:
   every comparison ends "you don't have to choose".
3. **Provider pages** (programmatic): /providers/[name] for 20+ providers. Pricing,
   features, supported params through the gateway, affiliate link. Data-driven from
   /packages/adapters registry so they update themselves.
4. **Target pages** (programmatic, phase 3, the unique dataset): /targets/[domain]:
   "Best proxy provider for scraping <domain>" backed by real scoreboard data:
   success rates and cost per provider. Nobody else can publish this honestly.
   This is the category-winning content play.
5. **Guides**: "Scraping proxy failover in Node", "Handling Cloudflare in 2026",
   "BYOK vs managed proxies: real cost math". One per week after launch, not before.

### Mechanics

- All SEO pages SSR/prerendered in TanStack Start, canonical tags, OG images generated
  per page, sitemap.xml, llms.txt (agents read docs too).
- Docs are content: every adapter guide targets "<provider> api node example" queries.
- Backlinks: openalternative.co, alternativeto.net, awesome-web-scraping lists,
  awesome-selfhosted (big one, requires a solid self-host story: we have it).
- YouTube/demo GIF: 60-second "provider dies, request survives" clip. Reused everywhere.

### Keyword starters

"scrapeops alternative", "scraperapi alternative", "open source proxy aggregator",
"proxy failover api", "self-hosted scraping gateway", "scraping api comparison",
"best proxy for <domain>" (phase 3, programmatic).

---

## 7. Monetization Detail

BYOK is free forever. Self-host is free. Hosted credits are **phase 3 and not committed**,
because at the rate we would want to charge they do not clear their own costs once
failover attempts and payment fees are counted — and failover is the product, so the
attempts are not optional.

That is the whole public position. The rate table, the breakeven arithmetic and the
affiliate terms behind it are commercial and live outside this repo; `docs/state.md`
carries the open decision without the numbers.

**A prerequisite that is not a number, and so belongs here.** Hosted credits pool users behind
our provider accounts and sell that access as part of a product. Bright Data put in writing on
2026-09-01 that such a deployment falls outside their terms without separate written approval —
see section 18. So the phase-3 decision is not only "does the margin clear"; it is "do we hold
written approval from every provider in the chain", and the answer today is no for all four.
Margin was always the reason this was uncommitted. Permission is a second, independent gate,
and unlike margin it cannot be settled by collecting more traffic.

Two consequences that ARE public, because they shape the code:

- Billing charges only on `OK`. Every other outcome is unbilled spend, which is why
  `X-Cost-Estimate` sums every attempt rather than the winning one.
- **The dominant unbilled spend is not failover, and that changes what has to be decided.**
  Running every recorded fixture through its adapter shows what the PROVIDER charges us for:
  `TARGET_NOT_FOUND` is billed by all four, and `TARGET_RATE_LIMITED` and `TARGET_ERROR` are
  billed by most. Those are target facts, not blocks. A 404 never fails over, so it is exactly
  one paid attempt every time, and a caller generates them for free simply by holding a stale
  URL list. Blocks at least arm a cooldown, which bounds them; a dead link is unbounded.
  So the open question is not only "what rate", it is **which outcomes the caller pays for**.
  Charging for anything the target genuinely answered, while still absorbing blocks, keeps the
  promise where it is defensible and removes the unbounded part. That is a rate-table decision
  and stays commercial, but the *shape* is public because it decides what the ledger records.
- **`X-Chain` is the instrument for it.** It records `provider:outcome` for every attempt, so
  the ratio of provider-billed non-`OK` outcomes to `OK` ones is readable straight from the
  request log, per provider. Before it there was no way to measure the thing the rate depends
  on, and the fixture corpus contains no block recordings at all (`state.md`).
- Affiliate rate is never an input to routing or rankings. That is a house rule in
  `CLAUDE.md`, not a preference.

## 8. Metrics and Kill/Pivot Criteria

The project has explicit stop conditions and a review cadence. They are numeric, they are
about a solo maintainer's time and money, and they are kept private — publishing a date on
which one would consider stopping is an invitation for it to be quoted back.

What is public: **capacity is the binding constraint, not ideas.** Phase 1-2 was estimated
at roughly twice the hours actually available, and the three-week live-canary clock cannot
be compressed. Scope decisions in this repo should be read against that, which is why
`selfhost:smoke` and `conformance` are the definition of done rather than a longer list.

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Provider ToS on aggregation | Ask before launch, lead with affiliate relationship; ScrapeOps precedent shows providers accept aggregators as a channel. Drop any provider that objects. |
| Hosted-mode abuse lands on our master accounts | Domain gating + KYC-heavy providers only via BYOK; hosted mode launches with conservative allowlist. |
| Support gravity ("the gateway broke my scrape") | Self-serve debugging: X-headers on every response, per-request timeline in dashboard, detect-rule IDs. Docs page: "why did my request fail". |
| ScrapeOps responds (adds BYOK or open sources) | Speed + community + AGPL. Also: their business is the closed routing data; opening up cannibalizes them, classic innovator's dilemma. |
| Anti-bot arms race | Explicit non-goal: we never build unblocking. Thin router forever. Providers fight that war. |
| Scope creep (known personal pattern) | Rules: no adapter #4 until 3 are flawless; no smart routing until dumb failover has real traffic; no product #2 before first revenue. |
| Traffic costs on hosted tier | Responses proxied through us; cap response size, stream, and price bandwidth-heavy domains via multipliers. Hetzner bandwidth is cheap; monitor anyway. |
| **A provider terminates the program or the account over our comparative content** | Section 14 commits to publishing per-provider rankings including where a provider loses. Impact-run programs restrict comparative claims and disparagement and permit termination with forfeiture. Ask in writing in Phase 0 (`affiliate-emails.md` question 3), never depend on a single program, and treat a "no" as disqualifying that provider from the affiliate plan rather than as a reason to soften the data. |
| **Loss of the intermediary defence on keyless paths** | The "users choose targets" position below needs a user. Keyless paths have none. Gated to phase 2 and to counsel; see section 18. |
| **Firecrawl, and anyone else running this playbook as a provider** | AGPL core, self-hostable, hosted differentiated by managed anti-bot — our licence strategy, in our category, with a large head start on the MCP channel. They are also a planned adapter, which is not a contradiction but must be said out loud: see section 16, and the contract question in `integrations.md` section 9. We do not compete on unblocking (that is the explicit non-goal above); we compete on routing across providers, which a provider structurally cannot do. |

The parties with both motive and leverage over us are **the providers**, not ScrapeOps.
They fund us through affiliate, they can terminate us, our headline feature routes their
customers away from them, and our content publishes their losses. The risk table had no
row for that until now.

Legal note, and it is closer to a blocker than this table implied: we are a router, users
choose targets. Mirror the provider ecosystem's standard ToS language (user responsible
for lawful use). That framing holds only where an identifiable user chose the target,
which is exactly what section 18's keyless paths remove. Get real advice before enterprise
deals **and before any keyless path ships**.

---

## 10. Naming (decided, then re-opened once, then decided again)

Proxlane, `proxlane.dev`, GitHub and npm orgs registered. Package naming (`proxlane` unscoped for
the CLI, `@proxlane/*` for the rest, images to `ghcr.io/proxlane/*`) is in `CLAUDE.md`.

**`proxlane.com` is a live commercial product and this section did not know it.** It is a
developer tunnel service — "Expose localhost without port forwarding", paid monthly tiers — and it
outranks `proxlane.dev` for the bare word. Both are developer infrastructure with "prox" in the
name, so this is not distant confusion: someone told "check out proxlane" and left to search will
land on a different company's product.

The original decision was marked done and its reasoning moved to `docs/archive/`, which is exactly
where a decision goes to stop being re-checked. It was never re-checked, and the collision was
found by a review panel twelve weeks later.

**The decision is: keep the name, and stop using it bare.**

Written and spoken as **proxlane.dev**, always, including in the launch post, in comment replies,
in the README's first line and in conversation. The bare word is ceded. We will not own the brand
SERP and are not going to spend on trying.

Why this rather than renaming, stated so it can be argued with rather than assumed:

- A rename costs a weekend now and is *free of audience cost* at 0 stars and 5 visitors — that is
  the honest counter-argument and it is a good one. What it also costs is the npm org, five
  published package names, the GHCR path, the domain, and every internal reference. The name is
  load-bearing in a way the audience is not.
- The confusion is asymmetric and mostly harmless in our direction. Someone searching for a tunnel
  service does not want a scraping gateway and bounces; someone who has seen `proxlane.dev`
  written has the disambiguator in hand.
- The window closes the moment the launch post ships, because that is where the name is typed at
  scale and where the first backlinks form. Deciding now is the point; deciding *this* way is the
  cheaper half of a genuinely close call.

**What would reverse it:** the other product moving into scraping or proxy aggregation, or a
trademark claim. Neither is true today. If either becomes true, the rename is still a weekend, and
it is a weekend better spent then than now.

---

*(There is no section 11. The gap is deliberate: other documents and the agent briefs
reference these sections by number, so renumbering would break more than it tidies.)*

---

## 12. Infrastructure audit (do before week 1)

Moved to `docs/archive/strategy.md` — read-once. The action it asks for is tracked in
`docs/state.md`; the standing conclusion is that the gateway gets its own instance and
never shares CPU with cron scrapers, which is already in `operations.md` section 1. Note
the private infrastructure runbook already answers most of the audit.

---

## 13. Converting BYOK users to hosted credits

BYOK is not only a free tier, it is a conversion funnel with a natural trigger. The
quota monitoring built for hosted mode works on BYOK accounts too, and it means we
know a user is about to hit a wall before they do.

Two moments worth building for:

**The hard stop.** ScrapingBee has no overflow: run out of credits and scraping stops
until someone upgrades or renews. ScraperAPI needs a dashboard click. When we detect
a BYOK key approaching exhaustion, that is the single best moment to offer hosted
credits, because the alternative is downtime. In-app banner plus an email, with a
one-click path that keeps the same gateway key and simply changes which account the
requests run on. The user changes nothing in their code, because that is the entire
premise of the product.

**The blocked domain.** A BYOK user whose providers all fail on a domain we can serve
through a provider they do not have an account with. Offer that specific domain on
hosted credits rather than asking them to switch wholesale.

Both are honest offers: they fire on a real problem the user is having, at the moment
they have it. Rules to keep it that way: never fire more than once per problem, never
gate the free tier's features to manufacture the trigger, and always show what it
would have cost. If the offer needs urgency language to convert, the trigger is
wrong.

### The conversion destroys the user's value — OPEN, downstream of section 7

Section 7 presents affiliate and hosted credits as complementary shares of one pie. On a
per-user basis they are **substitutive**, and the substitution is heavily negative. Same
user, same $100/mo of provider spend:

| | Revenue to us | What we also take on |
|---|---|---|
| Referred, stays BYOK | $25-50/mo recurring | nothing |
| Converted to hosted | $105 billed, ~$100 paid out, **$2-3 gross** | provider ToS exposure, treasury, fraud, chargebacks, support |

Converting a referred user destroys roughly 90% of their value to us and buys operational
burden with the remainder. Worse, the triggers above fire *precisely* when a user's spend
is about to become recurring commission: the hard stop arrives when they are scaling up,
which is when the commission is compounding.

This does not make section 13 wrong — it makes it conditional on section 7. If the markup
rises to something that survives the detector, the comparison changes. If it does not,
these triggers are a machine for converting recurring revenue into break-even revenue.

**OPEN, and downstream of section 7.** Build no conversion trigger until that resolves.

## 14. Routing integrity

Cost-aware routing is the feature, and it has a conflict of interest baked into it.
We earn affiliate commission on some providers and not others, at rates from 25% to
50%. If those rates influence which provider a request is routed to, or which
provider ranks highest on a comparison page, the product is a lie and a knowledgeable
user will eventually prove it with a benchmark.

Rules, stated publicly in the docs:

- Routing uses measured success rate, latency, and cost per success. Affiliate rate
  is not an input and never will be.
- Provider ranking on comparison and /targets pages is generated from the same
  measured data, not written by hand.
- Affiliate relationships disclosed plainly on every page carrying a referral link.
- The routing scoreboard is published. Anyone can check our ranking against our data.

This is a real commercial cost: we will sometimes route away from the provider that
pays us most. Publishing the data is what makes the whole comparison strategy
credible, and credibility is the only durable advantage over the pay-to-play proxy
review sites that dominate these keywords.

On aggregating across users: the scoreboard is built from anonymized outcomes
(domain, provider, success, latency, cost) pooled across hosted traffic and opted-in
self-hosters. It never involves using one user's provider key to serve another user's
request. That is a bright line, not a policy preference.

## 15. Why not just scrape yourself, and the agent wave

Moved to `docs/archive/strategy.md` — read-once. Its live conclusion is section 16: the
people who pay for scraping APIs have already tried the free path and hit a wall, which
is why migration and comparison pages target people who already pay someone. The archive
also records why Firecrawl's MCP traction is not evidence the channel pays *us*.

---

## 16. Being the thing agents reach for

An agent writing a scraper picks a fetch layer in the first thirty seconds, before it
knows the target blocks bots. Winning that choice is a distribution problem with four
distinct surfaces, and only one of them is classic SEO.

### The four surfaces

**1. Retrieval at coding time.** When an agent searches mid-task, it reads whatever
comes back. Optimize for machine reading, not for humans skimming:

- `llms.txt` and `llms-full.txt` at the root, listing every doc page with one-line
  descriptions.
- Every docs page available as raw markdown at the same path plus `.md`. ScraperAPI
  already does this and it is table stakes now.
- A published OpenAPI spec at a stable URL. Agents consume specs directly.
- One canonical page per failure symptom, written to be the answer rather than to
  rank: "403 when scraping", "200 response with a captcha page", "Cloudflare
  challenge in Playwright", "DataDome block detection". These are the queries an
  agent runs *after* its first attempt fails, which is the highest-intent moment in
  the entire funnel. The page explains the problem properly, then shows the one-line
  fix.

**2. The failure moment.** The agent's plain `fetch` returns a captcha page with a 200
status, and the agent cannot tell it failed. Our leverage is being the thing that
makes the failure legible. A `proxlane` npm and PyPI package that is
fetch-compatible:

```js
import { fetch } from 'proxlane';   // same signature, failover underneath
```

The smallest possible diff from what the agent already wrote. That, plus explicit
outcome codes in every response, means an agent can act on a failure instead of
looping. Machine-readable failure is worth more to an agent than to a human.

**3. Tool surfaces.** MCP server in phase 2, registered in the public MCP directories.
A Claude Code skill and a Cursor rule, both of which are a file in a repo and cost an
afternoon. An `AGENTS.md` in our own repo so agents working *on* Proxlane behave.

**4. Training data, the slow one.** Mentions in public repos, answers, and posts
compound over years and cannot be rushed. The only honest lever is being genuinely
useful in public for long enough. Do not build a strategy around it.

### The signup problem

An agent cannot create an account, verify an email, or paste a card. Anything
requiring credentials stops the agent and it falls back to plain `fetch`. Two answers,
both of which we already have:

- **Self-host** works with zero signup: `docker compose up` with the user's own
  provider key. Document this path *first* in agent-facing docs.
- **A keyless trial endpoint**, heavily rate limited by IP, no account, small daily
  ceiling, clearly labelled as a trial. It lets an agent prove the fix works in the
  same session it hit the wall. Abuse risk is real, so cap hard, block known-hostile
  targets, and treat it as marketing spend rather than a product tier. **Gated to phase 2
  and to written provider permission; see section 18.**

### What an agent-acquired user is worth — OPEN, owner decides

Both answers to the signup problem monetise at **zero**. Self-host runs on the user's own
provider key with no referral in the loop, and the keyless trial is pure cost by design.

Firecrawl is the instructive comparison, and it is worth naming plainly because this
document elsewhere cites them as the proof that the channel works. **Their MCP server
converts because Firecrawl *is* the provider** — every tool call is billable to them.
Ours routes to someone else's account, or to nobody's. Same channel, opposite economics,
so their traction is evidence the channel exists and is *not* evidence that it pays us.

They are also, on the same facts, the closest thing this project has to a direct
competitor: AGPL core, self-hostable, hosted differentiated by managed anti-bot, already
established in the MCP directories. And they remain a planned adapter, which is not a
contradiction — a provider can be both a competitor and a route — but the docs should
not cite them as a precedent without saying the rest. See the risk table in section 9,
and the contract question in `integrations.md` section 9.

So the agent channel is a distribution play whose revenue is entirely deferred: it pays
only if an agent-acquired user later attaches a provider key through the affiliate flow,
or converts to hosted. That may well be worth it — top-of-funnel usually is — but it
needs saying, and it needs a cap rather than an assumption.

Two coherent positions: accept the channel as capped brand and top-of-funnel spend with a
stated monthly ceiling, or move the MCP server out of launch scope. The archived section
15 argues to pull MCP *into* phase 2, and section 18's gate pushes the keyless path *out*
of it; those cannot both hold.

**OPEN, same decision family as section 18's gate.** Tracked in `docs/state.md`.

### What not to do

Do not write agent-bait content farms, do not stuff pages with model names, and do
not publish benchmark claims we cannot reproduce. Agents increasingly cite sources
and users increasingly check them. The durable version of AI SEO is being the most
accurate, most machine-readable explanation of a real problem.

## 17. Cost control before traction

Marginal compute is effectively zero: the gateway co-tenants on an existing box rather
than taking a new instance. The only new recurring cost is a small volume resize.

Operating rules that follow, and that apply to any self-hoster equally:

- Never build on the deployment box; build in CI and pull the image.
- Cap every container. An uncapped one takes the whole host down with it.
- Prune images on a schedule; never prune volumes.
- Treat any free or trial tier as a fixed monthly ceiling, reviewed monthly rather than
  per incident.

Entity, tax and accounting arrangements are out of scope for this repo.

## 18. Growth mechanics: letting people try it for free

The conversion problem is that scraping only hurts when it breaks, and by then the
person is mid-incident and not shopping. Every tactic below works by letting someone
see the product solve a problem they already have, without an account.

### None of this ships at launch — OPEN, owner decides

**This section and section 17 contradict each other outright.** Section 17: "run the
canary weekly and skip the keyless trial at launch and the number is under EUR 6 a
month." This section makes the keyless trial the flagship and calls the blocked-domain
checker "the highest-leverage thing on the list." Both cannot ship. **Section 17 is the
launch position**; mechanisms 1, 2 and 3 below are phase 2 at the earliest.

The reason is not cost. It is that mechanisms 1, 2 and 3 all run **a stranger's request
on our provider account**, and they do it on trial and free-tier accounts where provider
terms bite hardest. ScraperAPI's terms forbid reselling, sublicensing, account sharing,
and "develop or use any applications that interact with our Service without our prior
written consent." Section 9 gated provider-ToS risk at phase 3 because it assumed hosted
credits were the only place strangers touch our accounts. They are not.

**The gate, restated:** written provider permission is required before *any* path where a
stranger's request runs on our account — not merely before hosted credits. That is a
phase-2 gate on 18.1, 18.2 and 18.3.

**A second exposure, distinct from provider ToS.** Section 9's defence is "we are a
router, users choose targets." That defence needs a user. On a keyless path there is
none: we initiated the request, we chose the provider, and we are the only identifiable
party — a Swedish entity that is easy to serve. And "we did not know the target objected"
is unavailable to us specifically, because detecting that objection is our headline
feature. `operations.md` section 5 offers only a denylist of "known illegal targets",
which does nothing about lawful sites whose terms forbid scraping, i.e. nearly all of
them.

Before any keyless path ships: get Swedish counsel on intermediary status, and decide
allowlist-versus-denylist for free paths. If counsel is unaffordable pre-revenue, that is
itself the answer about whether keyless paths ship at launch.

> **Interim default, reversible.** Mechanisms 1, 2 and 3 are not built and not
> documented as available. This lifts when written provider permission and a counsel
> opinion are both in hand. It is a default rather than a decision because the cost of
> being wrong is asymmetric: building ahead of the gate spends provider credits under
> terms we have not cleared, and cannot be un-spent.

**The first written answer arrived 2026-09-01, and it confirms the gate rather than lifting
it.** Bright Data's compliance answer splits exactly where this section guessed it would:
BYOK on the user's own account is **not** reselling and raises no issue on their side, because
the obligations sit with the account holder. But a deployment that **pools multiple end users
behind a single account, or offers their service as part of a paid product, falls outside their
terms without separate written approval.**

That sentence is worth reading twice, because it is broader than this section. Mechanisms 1–3
are a stranger's request on our account, so they are named by it. **So is hosted credits** —
section 7's phase-3 model is by construction users pooled behind our account, sold as a
product. The gate was written as a phase-2 constraint on free-try paths; one provider has now
put in writing that it reaches the revenue model too.

This is one provider of four, and it does not travel: the terms this section quotes as the
binding ones are ScraperAPI's, and they have not answered. What changed is that the risk stopped
being our inference from published terms and became a provider's own statement — which is the
difference between a guess we could be talked out of and a condition with a named route through
it (ask for the approval).

**ScrapingBee's answer is the one to be careful about, because it reads as a yes and is not
one.** Asked the same question on 2026-08-24, they answered in two voices. Their own AI replied
first and declined: it could not give a definitive yes or no from the published terms, which it
quoted as making API access *personal, non-assignable and non-transferable* and as prohibiting
*making the API available to a third party*. A human then followed with "as long as there is no
information stored, it should not be an issue".

So what we hold is a support agent's hedged opinion, conditional on a fact about storage, landing
directly after their own system read the same terms the other way. That is not the written
permission this section asks for, and the AI's citation is the sharpest adverse reading any
provider has given us — sharper than Bright Data's, which blessed BYOK outright.

The ambiguity is real rather than evasive: in self-host BYOK the account holder runs it
themselves, so it is arguable no third party exists. Arguable is the point. Recorded here as
ambiguous, not as agreement, because the failure mode this section exists to prevent is reading
a polite reply as a clearance.

One thing from them IS firm and worth keeping: the benchmark is fine **provided the methodology
is public**, which it already is. That is a condition we meet and can cite.

**OPEN.** Tracked in `docs/state.md`.

**Off the table first.** Registering provider accounts on a user's behalf. Provider
terms forbid it, Bright Data and Oxylabs enforce mandatory ID verification, and it
would place a stranger's scraping under our identity. This is the one idea in the
space carrying legal rather than merely financial risk. Not a cost question, a no.

### The one that is not gated: sandbox mode

`integrations.md` section 6 specifies a sandbox replaying the fixture corpus behind
`X-Proxlane-Simulate`. It belongs in this section's list and it **clears this section's
gate**, because the gate is "a stranger's request runs on our provider account" and a
sandbox makes no provider request at all — it returns recorded bytes. No ToS exposure, no
credits, and nothing to abuse: it cannot be turned into a free scraping proxy, because it
never fetches the target. The guardrails below all exist to bound spend on strangers and
therefore do not apply to it either.

What it buys is narrower than mechanisms 1–3. It demonstrates the *shape* of the product,
not that we can scrape a page the visitor actually cares about, so it is a developer
onboarding surface first and a growth one second. It is also **phase 2 at the earliest**:
it needs the fixture corpus phase 1 produces, and section 8 already finds phase 1–2
committed at roughly twice the available hours. Adding it to weeks 5–8 without removing
something is how the stop condition in section 8 gets hit.

### The five that work

**1. `npx proxlane try <url>`**

Zero install, zero signup, one command. Scrapes through a shared trial pool and
prints the outcome: provider used, attempts, whether detection fired, estimated cost.
The shortest distance from seeing a link to watching it work, for an audience that
already lives in `npx`. It is also the only free-try mechanism an *agent* can use,
since it needs no credentials and returns structured output. Ship the equivalent
`uvx`/pipx entry point for the Python half of this market.

**2. Public blocked-domain checker**

Paste a domain, we test it across three providers, and return a matrix: success rate,
latency, and cost per provider on that target. Free, no account.

This is the highest-leverage thing on the list because it is simultaneously the demo,
the lead magnet, and the data moat. Every check feeds the per-domain scoreboard.
Those results become programmatic `/targets/<domain>` pages ("which provider actually
works on X"), which rank for exactly the query someone types when a target starts
blocking them, which brings in more people who run more checks. Demo, content, and
dataset are the same loop.

Publish the aggregate results openly. Nobody else can, because nobody else routes
across providers, and the pay-to-play proxy review sites have no incentive to.

**3. Playground that renders the hero diagram with their URL**

Paste a link on the landing page and the route diagram animates the real request,
including a real failover when one happens. Most landing page demos are canned; this
one cannot be, and the component already exists because it is the same one the
dashboard uses. Rate limited, cached per URL, and it doubles as the fastest possible
answer to "does this actually work".

**4. GitHub Action: target health check**

A free Action that runs weekly against a repo's scrape targets and posts a summary of
which ones are blocking. Puts the name inside repos and README badges, which is also
the only honest way to influence the slow training-data surface. Low effort, long
tail.

**5. Reverse trial on hosted credits**

Small credit grant at signup, no card. Unglamorous and it works. This is where
everyone arriving through 1 to 3 lands once they want it running in production.

### Guardrails, without which none of this is safe to leave running

Everything above spends our provider credits on strangers.

- Hard per-IP daily ceiling and a hard global daily ceiling.
- Target denylist, and no high-risk domains on any free path.
- Fail closed when the daily budget is exhausted, with an honest message and a link
  to self-host, which is free and unlimited.
- Cache aggressively per URL: the same demo link gets hit repeatedly.
- Treat the monthly cap as fixed marketing spend, set at something like €20, and
  review it monthly rather than per incident.
- No free path may run on a hosted master account that also serves paying customers.
  Separate account, separate blast radius.

If the free tier is ever the thing that breaks the budget, the ceiling was set wrong,
not the idea.

## 19. First customers

The maintainer runs other scrapers, and they are the first real traffic: a user who is
also the operator finds the honest-failure cases fast, because they already know which
targets are hard.

**What that traffic must not become is a published corpus.** Recording real scrapes of
named commercial sites and shipping them here would be dated, self-published, permanent
evidence of automated access against a named site's defences — with a measured success
rate — landing on properties with paying customers. So:

- No fixture in this repo may be recorded from a named commercial target. The corpus uses
  stable, purpose-built endpoints; block and captcha fixtures come from a private set.
- Public pages, scoreboards and comparisons report **classes** of target, never names.

`growth-engineer.md` carries the same rule for anything generated.

## 20. Day-1 Checklist

Phase 0 only — what to do before writing code. The **launch** checklist is
`operations.md` section 9.

- [ ] Domain + GitHub org + Discord + X handle
- [ ] r/webscraping validation post live
- [ ] 4 affiliate applications sent
- [ ] Trial accounts at ScraperAPI, ScrapingBee, Scrapfly; fixtures captured
- [ ] Monorepo scaffolded (pnpm + turbo + Biome + Vitest)
- [ ] Drizzle schema v1 migrated on local Postgres
- [ ] Hono gateway answers /health behind Dokploy
- [ ] First fixture test green in /packages/detect

Ship the skeleton this week. Everything compounds from a public repo with a working
`docker compose up`.
