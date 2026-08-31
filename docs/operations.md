# Proxlane: Operations and Security

Companion to `plan.md` (strategy) and `integrations.md` (adapter architecture).
This covers everything needed to run Proxlane as a real service rather than a demo.

---

## 1. Traffic and scaling

The gateway is a reverse proxy with a decision layer. Its scaling profile is unusual:
almost no CPU, almost no memory, but very long-lived connections (a ScraperAPI attempt
can hold for 70 seconds) and large response bodies.

**Concurrency model.** Node handles this fine because it is nearly all waiting on I/O.
The constraint is open sockets and memory held by buffered bodies, not CPU.

**The ceiling is derived, not guessed.** A per-request body cap does not bound aggregate
memory — `maxInflight × cap` does, and nothing used to tie backpressure to either.
Buffer plus the detector's working set runs roughly **2.5× body size**, and it lives in
external memory outside `--max-old-space-size`, so exceeding it is an **OOM kill, not a
GC pause**. On a 4 GB box at a 10 MB cap that is `4096 / (10 × 2.5) ≈ 160` concurrent
worst-case, so:

```
maxInflight default 128        # low hundreds, not "low thousands"
boot-time assertion: maxInflight * bodyCapMb * 2.5 < availableMb   (Zod refine, fail fast)
```

Note the target box: **CAX11 is 2 vCPU / 4 GB**, not the 4 vCPU / 8 GB this section used
to size against — that is CAX21. `plan.md` section 17 no longer carries instance budgets, so either
size up or accept that the ceiling above is the
ceiling. **OPEN**, tracked in `docs/state.md`; it is a cost decision, not an engineering
one.

**Non-negotiables from day one:**

- **Body size cap.** Default 10 MB, configurable. This is the one place the number is
  defined; `integrations.md` references it. Reject beyond it with `RESPONSE_TOO_LARGE`
  rather than OOMing the process. Without this one bad target (a PDF archive, an infinite
  stream) takes the gateway down.
- **Buffer, then validate, then forward.** Detection needs the body, so v1 buffers.
  Cap protects you. Streaming pass-through for `detect=false` requests is a later
  optimization, not a launch feature.
- **Global deadline separate from per-attempt budget.** Default **120s**. A client asks for
  less via the `timeout` param and never for more: the operator's deadline is the ceiling,
  because it is what bounds how long one request holds an in-flight slot and `maxInflight` is
  sized assuming that holds. This said "max 180s" for a long time, which was never
  implemented and would have let a caller outspend the operator's own budget.
  Per-attempt budget reserves time for the hops that follow it, the formula is in
  `integrations.md` section 5, and at the old 90s default a three-attempt chain degraded to
  roughly 1.5 attempts. That 120s was recorded here and left unimplemented until it was
  measured: the terminal hop was getting 38s of its 70s cap.
  Never let a failover chain outlive its client.
- **Per-org concurrency limits.** Valkey token bucket keyed by org. Prevents one user
  saturating the pool. Also mirrors what providers do to us: their 429s are a
  concurrency cap, not a rate cap, and we must respect that per provider key.
- **undici Agent tuning.** `connections` per origin, `keepAliveTimeout`,
  `headersTimeout` and `bodyTimeout` set explicitly per adapter. Node defaults will
  kill ScraperAPI's long retries.
- **Backpressure.** When the in-flight count exceeds a ceiling, return 429 with
  `Retry-After` rather than queueing. A proxy that queues silently becomes a
  latency black hole.

**Horizontal scale.** The gateway is stateless: all shared state (cooldowns, buckets,
scoreboard) is in Valkey. Scaling is `docker compose up --scale gateway=N` behind
Caddy or Traefik. Do not put the gateway behind Cloudflare (you would be proxying
scraping traffic through a company whose product is blocking scrapers).

**Sizing path.** Start on the existing Hetzner box. Move the gateway to its own
dedicated CX/CCX instance the moment hosted traffic exists, so it never shares CPU
with cron scrapers. Postgres stays separate from the gateway node. Hetzner egress is
generous and cheap, which matters because every scraped body flows through us twice.

**Load testing before launch.** k6 scenarios against a local mock provider that can
simulate slow responses, 429s, and huge bodies. This is a launch gate, not a
nice-to-have — but as it was written ("p95 overhead under 50 ms, no memory growth over a
30-minute soak") it was unmeasurable: no concurrency, so it passes trivially at 1 VU; no
instrument separating gateway time from provider time, against a mock with no provider
latency to subtract; and no threshold on "growth". The gate, specified:

| Assertion | Threshold |
|---|---|
| Load | 50 VUs sustained for 30 minutes |
| Gateway-internal p95 | `< 50 ms`, measured from a `Server-Timing: gw;dur=` header the router emits, **not** from end-to-end request time |
| RSS slope, minutes 10-30 | `< 1 MB/min` (first 10 minutes excluded as warm-up) |
| Behaviour at `maxInflight` | 429 with `Retry-After`, zero 5xx, zero dropped connections |

`Server-Timing` is worth emitting in production too: it is the same number a user needs
when they ask whether the gateway or the provider was slow.

---

## 2. Queues and async work

The hot path is synchronous by design. A queue in the request path would add latency
and a failure mode for zero benefit. Queues serve everything around it.

**BullMQ on the same Valkey.** Workers run as a separate process from the gateway so a
slow job can never touch request latency.

| Queue | Job | Cadence |
|---|---|---|
| `usage-rollup` | aggregate `requests` into `domain_stats` windows | every 5 min |
| `billing` | hosted credits: deduct, low-balance alerts, invoice records | on demand + hourly reconcile |
| `canary` | live provider probes, open drift issues | per `operating.md` B6 |
| `cost-drift` | diff reported vs estimated cost, alert on stale tables | hourly |
| `email` | transactional sends via provider | on demand |
| `retention` | detach and drop expired weekly partitions (never row-level DELETE) | daily |
| `stats-sync` | ingest opted-in self-host stats, publish routing table | hourly |

**Rules.** Every job idempotent and keyed (`jobId`) so retries are safe. Exponential
backoff, dead-letter queue inspected on the same cadence as the canary. No job may
write to `requests` or `request_attempts`; both are append-only from the gateway.

**Async scrape API (phase 3).** Providers offer webhook-based async jobs for slow
targets. When we add it, that is a real user-facing queue: submit, poll or webhook,
retrieve. Same BullMQ, different semantics. Not in v1.

**Writes on the hot path.** Do not write a row to Postgres per request synchronously.
Buffer in memory, flush in batches (every 1s or 500 rows) via a dedicated writer.
Losing a second of analytics on a crash is acceptable; adding 5 ms and a DB
dependency to every proxied request is not.

**Analytics batch; billing does not.** Losing a second of analytics is acceptable, but
section 4 requires every credit deduction to reference the request that caused it, so the
same batching would lose *billing events* on a crash. In hosted mode the ledger write is
**synchronous on `OK`**, and only the analytics rows batch. Two consequences:

- Row IDs are **uuidv7 generated in-process**, so a ledger entry can reference a
  `request_id` whose row has not been flushed yet. Nothing previously stated this, and a
  serial primary key makes batching impossible.
- The ledger entry **snapshots** what it billed for — provider, domain, outcome,
  `cost_micro`, `charged_micro` — and keeps `request_id` as a soft reference with no
  foreign key. Otherwise section 3's 30/90-day retention deletes rows that the permanent
  ledger points at, and the audit trail develops holes exactly where the money is.

---

## 3. Data layer

- **`requests` and `request_attempts` are partitioned by week** from the first
  migration, range partitioning managed as raw SQL outside the drizzle-kit diff (see
  `plan.md` section 3 for why). Retention: 30 days hot for BYOK free, 90 days for hosted,
  then **whole partitions detached and dropped** — never a `DELETE` over a partitioned
  table, which is what the `retention` job used to say and which defeats the point of
  partitioning. Weekly rather than monthly because 30- and 90-day windows cannot align
  with month boundaries. **Ledger entries are never subject to retention.**
  Self-hosters configure their own.
- **No full URLs by default.** Store `url_hash` plus registrable domain. Full-URL
  logging is per-org opt-in and clearly labeled in the dashboard. This is both a
  privacy posture and a marketing line, and it means a database leak does not expose
  what customers scrape.
- **Response bodies are never persisted.** Ever. Not for debugging, not for support.
  The only exception is fixtures, which come from our own test accounts.
- **Connection pooling** via pgbouncer once there is more than one gateway instance.
- **Migrations** run as an explicit step, never at boot, never `db push` in CI.
- **Backups** nightly `pg_dump` to object storage plus WAL archiving once hosted
  credits exist (losing a credit balance is losing money). Restore drill before
  launch, not after the first incident.

---

## 4. Payments (phase 3, but designed now)

**Model.** Prepaid credits, not subscriptions. User tops up, we deduct per successful
request at provider cost plus 5%. No seats, no monthly minimum.

**Why prepaid.** Positive float, no involuntary churn, no chargebacks on usage
disputes, and no dunning system to build. It also caps our downside: a user can never
run up a bill we have to eat with a provider.

**Stripe surface used:** Checkout for top-ups, Customer Portal for receipts and cards,
Payment Intents for auto-recharge. Deliberately not Stripe Billing subscriptions and
not their metering, because our credit ledger has to be authoritative anyway.

**Ledger design.** Double-entry, append-only `ledger_entries` table: top-ups,
deductions, refunds, promotional grants. Balance is a materialized sum, never a
mutable column that drifts. Every deduction references the `request_id` that caused
it **and snapshots the facts it billed on**, so the audit survives request retention (see
section 2). Any user can audit every cent. This is the single most important correctness
surface in the product; get it right before the first paying user.

**Credits are non-refundable and single-purpose** — redeemable only for Proxlane-routed
requests, never withdrawable as cash. Declare this before the ledger is built and put it
in the terms: a Swedish entity holding cash-refundable customer balances drifts toward
stored-value and PSD2 territory, which is a different regulatory conversation than
selling API usage. Confirm the wording with the accountant; tracked in `docs/state.md`.

**Deduction timing.** Charge on `OK` only, after detection passes. A soft block costs
us provider money and the user nothing. That is the promise; it must be enforced in
code, not policy.

**Auto-recharge and limits.** Threshold-based top-up, hard spend ceiling per org per
day, and a kill switch. A runaway loop in a customer's scraper must not drain their
balance overnight without a cap they set.

**Webhooks.** Signature-verified, idempotent by event ID, stored before processing.
Reconcile job hourly against Stripe as the source of truth for payments while our
ledger stays source of truth for usage.

**Treasury: getting money from Stripe into provider accounts.**

No scraping provider exposes an API to add funds to your balance. Nobody does. So
"transfer credits programmatically" is not available from any direction, and the
plumbing has to be a card on file instead.

The mechanism: enable auto-recharge on each provider account and put a card on it
that draws from money customers have already paid us. Three ways to do that, in
increasing order of automation:

1. *Business card, manual top-up.* Any business account card (Wise, Revolut) on each
   provider's auto-recharge. Stripe pays out to the bank on its normal schedule and
   you move money once a week. Five minutes weekly, zero build. Start here.
2. *Prefer postpaid providers.* Several bill monthly in arrears against a card rather
   than requiring prepaid balance. With those you never prefund at all: usage
   happens, the invoice lands weeks later, and it is paid from money already
   collected. When choosing which providers back hosted mode, weight postpaid
   billing heavily. It removes the problem instead of automating it.
3. *Stripe Issuing virtual cards.* Issuing is available in the EEA including Sweden.
   Create a virtual card per provider, funded from the Stripe balance, with spend
   limits per card. Customer top-up lands in Stripe, provider auto-recharge pulls
   from the same balance, and no manual transfer exists anywhere in the loop. Per
   card spend controls also cap the damage if a provider account is compromised.
   Requires approval and a real entity, so this is a month-three improvement, not a
   launch dependency.

**Float, correctly understood.** Prepaid credits mean customers pay before we spend,
so this is not a funding problem, it is a timing and buffer problem. Required working
capital is roughly one peak week of provider spend, held once, not topped up
continuously. If it feels like continuous front-loading, the buffer is sized too
small or credits are being sold below provider cost.

**A drained provider balance is an outage.** Monitor it like one. Scrapfly reports
remaining credit in response headers; others expose a balance endpoint or nothing at
all. Alert on low balance per provider, keep auto-recharge thresholds well above one
day of peak usage, and treat a failed auto-recharge as a paging event. The failover
chain hides a single provider running dry, which is exactly why it can go unnoticed
until two are dry.

**This is the hidden cost of hosted mode.** BYOK and self-host involve no treasury
operations whatsoever. That is a real argument for launching on those two alone and
adding hosted credits only once volume justifies the overhead.

**Per-provider billing automation, checked.** None of the launch three offer a
balance-threshold auto top-up you can drive from an API. What they offer instead:

| Provider | Runs out of credits | Automatic? | Notes |
|---|---|---|---|
| Scrapfly | pay-as-you-go auto-activates on quota exhaustion, billed at plan rate in 10k batches | yes, fully | best of the three. PAG hard-capped at 125% of monthly quota by default; request an increase before hosted traffic needs it. Failed scrapes not billed. Per-project credit budgets available, useful for capping a single customer |
| ScraperAPI | pay-as-you-go on Scaling and above, with a spending cap you set | partly | continuation is offered via a dashboard prompt, so it can require a human click. Treat quota exhaustion as a paging event, not a silent overflow |
| ScrapingBee | no overflow. Upgrade the plan or early-renew the subscription | no | a hard stop. Running out is an outage until someone acts |

Design consequences:

- Provider quota is monitored state, not a billing detail. Track remaining credit per
  provider (Scrapfly reports it in response headers; others need a dashboard check or
  a scheduled probe) and alert well before exhaustion.
- Size subscriptions above expected peak rather than relying on overflow, especially
  for ScrapingBee.
- The failover chain masks a single provider running dry. Alert on
  "provider X served zero successful requests in N minutes" independently of overall
  success rate, or the first outage stays invisible until the second one lands. That
  query is only possible because `request_attempts` logs losing attempts as rows; against
  `requests` alone, a provider blocked 100% of the time is indistinguishable from one
  that was never tried.
- Weight postpaid, auto-overflow billing heavily when choosing which providers back
  hosted mode. On this evidence Scrapfly is the natural first master account.
- This is a further argument for BYOK-first: in BYOK the customer owns the quota
  problem, and it is their dashboard prompt to click.

**Tax and entity.** Swedish AB or enskild firma, VAT registration, and Stripe Tax for
EU VAT plus US sales tax nexus. Talk to an accountant before the first invoice, not
after. B2B EU sales use reverse charge, which Stripe Tax handles, but the entity
question is yours.

**Fraud.** Prepaid limits exposure, but stolen-card top-ups then heavy scraping is a
real pattern. Radar rules, low first-top-up ceiling for new accounts, and manual
review above a threshold.

---

## 5. Security

Proxlane holds two things attackers want: provider API keys, and the ability to make
arbitrary outbound requests. Both need real defenses.

**Provider key handling.**
- Encrypted at rest with libsodium sealed boxes, master key from env, never in the DB.
- Decrypted only in the request path, never logged, never returned by any API
  (dashboard shows last four characters only).
- Master key rotation procedure documented and rehearsed; envelope encryption so
  rotation does not require re-encrypting every row under downtime.
- Self-hosters generate their own master key at first boot; refuse to start with a
  default one.

**Where the key lives, and the boundary between the two processes.**
`packages/api`'s oRPC contract is described as "web ↔ gateway admin API", which would make
the gateway validate Better Auth sessions — contradicting "hot path only" — and would put
the provider-key master key in both processes, doubling its blast radius in a self-host
compose. The primitive already chosen solves this: **libsodium sealed boxes are
asymmetric**.

- `apps/web` serves the oRPC admin API and holds only the **public** key. It can write a
  provider key it cannot itself read.
- `apps/gateway` holds the **secret** key, validates gateway keys only, and never sees a
  Better Auth session.

**Gateway key revocation latency is bounded, or it is stated.** Any key cache keeps a
revoked key alive for its TTL with no invalidation channel — nothing in these docs
bounded that. Either publish revocations on a Valkey pub/sub channel the gateway
subscribes to, or set the cache TTL to 60s and **document that TTL in SECURITY.md as the
revocation guarantee**. Silence is not an option; a revoked key is a security control.

**SSRF, scoped to what v1 actually does.** We are, by design, a service that fetches
arbitrary URLs — except that in v1 **we never open the connection**. The provider fetches
the target on their egress. That makes edge validation of the `url` parameter correct and
sufficient:
- Scheme allowlist: http and https only.
- Reject private-range literals and hostnames that resolve into private ranges (RFC1918,
  loopback, link-local, IPv6 unique-local, cloud metadata at 169.254.169.254). A target
  of `http://localhost:8080` is rejected at our edge regardless of who would have fetched
  it. The outcome is `TARGET_FORBIDDEN`, which is a client error and does not page anyone.
- **IP pinning, redirect re-checks and the DNS-rebinding suite defer with the direct-fetch
  mode that would need them.** Rebinding attacks the gap between resolution and
  connection; v1 has no connection to attack. Building that suite now spends the security
  budget on a threat v1 does not have — spend it on abuse metering and the outcome
  taxonomy instead. Revisit the moment any direct-fetch path is proposed.

**Gateway keys.** Stored hashed (argon2id), shown once at creation, scoped per
environment, revocable, with `last_used_at` so users can spot stale ones. Support
multiple keys per org so rotation needs no downtime.

**Tenancy and roles.** Every user has an org, including solo users. Membership and roles
come from Better Auth's organization plugin: `owner`, `admin`, `member`. This repo had
`org_id` on every table and in the `cd:acct:{org}:{provider}` cooldown namespace long before
it had any statement of who may be in an org — tenants without a tenancy model.

| Resource | owner | admin | member |
|---|---|---|---|
| provider keys — add, rotate, remove | yes | yes | **no** |
| gateway keys — mint, revoke | yes | yes | **no** |
| request log and scoreboard | yes | yes | yes |
| org settings, invitations (never above own role) | yes | yes | no |
| billing, delete org, transfer ownership | yes | no | no |

The two that are judgement rather than convention are the key rows, and both are set to
admin-and-above because either one spends money: a provider key bills the org's own account,
and a gateway key authorises spending through it.

**Invitations carry an explicit role.** The plugin requires one per invitation and has no
configurable default, so the dashboard picker defaults to `member` and the inviter chooses
deliberately. Only `owner` and `admin` may send invitations.

**An inviter may not grant a role above their own**, enforced in the plugin's `beforeAddMember`
hook. There is no built-in restriction: the default `admin` cannot change the existing owner,
but nothing stops it inviting a *new* member as `owner` and inheriting billing and delete
rights through them. Same rule in `beforeUpdateMemberRole`, or the escalation just moves to
promotion.

Read access is deliberately wide, and the honest reason is narrower than "invitation is the
control". **Role cannot scope the request log today**, because a request is attributed to the
org and the gateway key that made it, never to a user — the gateway does not know users exist.
There is no "your traffic" to show a member, so the only coherent choices are all or nothing,
and nothing breaks debugging: a member who cannot see why something returned 403 escalates
every question to an admin, which is the support burden B9 exists to remove.

That is a real limitation, not a preference. A scraped-domain list can be commercially
sensitive (`plan.md` §19), and an org that wants a contractor to see only their own traffic
cannot have it. **So `gateway_keys` carries `created_by` from the first migration**: it costs
one column now and is the only thing that makes per-member scoping possible later without
migrating a table `request_attempts` already references. Revisit when a customer asks; teams
are the other half of that answer and are off.

**Roles govern the dashboard, not the proxy.** Gateway keys are org-scoped and the gateway
authenticates keys, never users; it never sees Better Auth at all. So anyone holding a gateway
key can scrape whatever their role says, `member` included. Revoking a member's access means
rotating the key, not changing their role.

**Nobody can read a provider key back, at any role.** Sealed boxes are asymmetric, so
`apps/web` writes keys it cannot decrypt. "Can a member view the key" is not a permission
question here — the answer is no for everyone, including the owner. Rotation replaces; it
never reveals.

**Auth.** Better Auth. TOTP available, required for orgs with hosted credits. Sessions
short, refresh rotated.

**Email is always on. OAuth providers are bring-your-own**, configured by env and enabled
only when present:

| Provider | Enabled when |
|---|---|
| email + password | always, no configuration |
| GitHub | `GITHUB_CLIENT_ID` **and** `GITHUB_CLIENT_SECRET` |
| Google | `GOOGLE_CLIENT_ID` **and** `GOOGLE_CLIENT_SECRET` |

This is the same posture as provider keys, and it exists for the self-hoster. Requiring
OAuth would mean registering a Google *and* a GitHub app before you can log in to your own
dashboard — a hostile first run for a product whose pitch is "self-hostable". Magic link is
not the escape hatch either: it needs SMTP, which is more configuration, not less. So the
zero-config path is email, and OAuth is the hosted convenience.

Two consequences that are easy to get wrong:

- **Half-configured is a boot failure, not a broken button.** A client ID without its secret
  fails the Zod boot schema, the same both-or-neither rule the rest of the env uses.
  Discovering it when a user clicks "Sign in with Google" is too late.
- **The sign-in page renders from what is configured**, never a hardcoded set of buttons. A
  self-hoster must not see a Google button that 500s.

`proxlane doctor` reports which providers are live, per the house rule that a new subsystem
ships its checks in the same PR.

**Accounts link on a verified email.** Signing up with Google and later returning via GitHub
on the same address gives you one account, not two. Both providers verify email, so both are
trusted for linking. Without this the second sign-in creates a fresh org holding none of your
provider keys, which reads as data loss and is a support ticket every time. Better Auth
defaults this off; it is opt-in config. The trap to watch is GitHub accounts whose email is
private or unverified — those must not auto-link.

**Plugins, and the reason the list is short.** The question that matters is not "is this
useful" but **"does it change `user` or `session`"** — those get foreign keys from every
other table, so adding one later is a migration across the schema. Everything else is a cheap
addition whenever it is wanted.

| Plugin | Phase 1 | Why |
|---|---|---|
| `organization` | **yes** | tenancy. Owns `organization`/`member`/`invitation`, adds two `session` fields. **Teams off** — two more tables, no customers |
| `twoFactor` | **yes** | already required for hosted-credit orgs. Adds `user` columns, so it is now or a retrofit |
| `haveIBeenPwned` | **yes** | no schema, few lines. We keep passwords for self-host, and a stolen account can *spend* provider keys |
| `admin` | **decide now** | adds `user.role`, `user.banned`, `session.impersonatedBy`. Support impersonation into a key-holding org needs an audit trail before it is switched on |
| `apiKey` | **no** | see below |
| `passkey`, `magicLink`, `emailOTP` | later | table-only or schema-free. Add when wanted, cheaply |
| `stripe` | phase 3 | and it models *subscriptions*; credits are an append-only ledger, so it may not fit at all |
| `sso`, `scim`, `oidcProvider` | no | enterprise surface, phase 3 at the earliest |

**`apiKey` is rejected deliberately, and the fit is closer than the rejection suggests.** It
does org-owned keys natively via `organizationId`, plus expiry, metadata, per-key permissions
and rate limits, and it offers secondary storage for fast lookups — so "it would mean a
Postgres read per request" is *not* the objection, and we already run Valkey.

The objection is one thing and it is structural: **`verifyApiKey` is a server-only endpoint
on a full Better Auth instance**, and there is no standalone verifier. Using it means
`apps/gateway` constructs Better Auth with a database adapter, which contradicts the process
split above — the gateway validates gateway keys and never sees Better Auth, so that the
sealed-box secret key and the session layer stay in different processes. Adopting the plugin
would put auth in the proxy to save writing one table.

Secondary: the plugin's docs do not state how keys are stored, whereas `gateway_keys` pins
argon2id. Unspecified hashing is not acceptable for a credential that authorises spending.

`gateway_keys` stays hand-written and gateway-validated. Recorded with its reasoning because
the feature list genuinely matches and it will be proposed again.

**Application hardening.**
- Zod validation on every input including env at boot; fail fast on bad config.
- Rate limits: per key, per IP, per org, plus a global ceiling.
- Response header sanitization: never forward provider auth headers, cookies from
  our accounts, or anything that leaks our infrastructure.
- CSP, HSTS (mandatory on .dev anyway), no inline scripts on the dashboard.
- Dependency scanning via Renovate plus `pnpm audit` in CI; Socket.dev or similar
  for supply chain, since an OSS project is itself a supply-chain target.

**Secrets in CI.** Live canary keys are GitHub Actions secrets on trial accounts with
spend caps. Never in the repo, never in fixtures. The record script sanitizes
automatically and CI fails if a fixture matches a key-shaped pattern.

**Abuse of the hosted tier.** Domain denylist (known illegal targets), volume
anomaly detection, and a documented process for provider complaints. Our master
accounts are the asset at risk: one abuse incident that gets a Bright Data account
terminated ends the hosted business. Conservative allowlist at launch.

**Disclosure.** `SECURITY.md` with a contact address and a 90-day policy. GitHub
private vulnerability reporting enabled. Expect real reports; an SSRF-adjacent
service invites researchers.

---

## 6. Open source operations

The license is the business model, so treat governance as product work.

**License.** AGPL-3.0-only for the gateway, web app and CLI. Permissive (Apache-2.0) for
the client SDK and the adapter kit, so nobody hesitates to depend on them. This split
is deliberate: copyleft where a competitor would host, permissive where a user
integrates.

**CLA or DCO.** Use a CLA (via cla-assistant) if you ever want to relicense or offer
a commercial license to enterprises. Use DCO if you want lower contribution friction
and never plan to relicense. Recommendation: CLA, because enterprise self-host deals
are in the plan and they routinely ask for non-AGPL terms. Decide before the first
external PR, because retrofitting requires chasing every contributor.

**Repo furniture at launch:** README (done), CONTRIBUTING with the adapter guide,
CODE_OF_CONDUCT, SECURITY.md, LICENSE, issue and PR templates, a labeled roadmap,
and `good-first-issue` on three real adapter tasks. The adapter conformance suite is
what makes drive-by contributions safe to merge.

**Release discipline.** Changesets, semver, signed tags, GitHub Releases with real
notes. Docker images to ghcr.io tagged `:latest`, `:1.2.3`, `:1.2`, built
multi-arch (amd64 and arm64, because self-hosters run Pi and Ampere boxes).
Publish a `compose.yml` that pins a version, not `latest`, for anyone who wants
stability.

**Self-host support burden.** This is the hidden cost of the model. Mitigate with:
a `proxlane doctor` command that checks env, connectivity, provider keys, and prints
a shareable diagnostic; a troubleshooting docs page; and an explicit statement that
community support is best-effort via Discord and GitHub, with paid support as the
enterprise tier. Say it plainly rather than quietly disappointing people.

**Telemetry.** Off by default. Opt-in only, anonymous, documented field by field in
the docs, and disable-able with one env var. The scoreboard exchange (share stats,
get the routing table) is a value trade, not surveillance, and must be presented as
one.

---

## 7. Design

See `docs/design.md`. It is the only design spec: the brief, the chosen direction
(D, the transit diagram), the library stack, the copy rules, and the build notes.

This section previously re-prescribed Direction A — the rejected one, palette and all —
after D had been chosen, which meant two documents pointed a design agent at different
directions. The rejected directions live in `docs/archive/design-directions.md`.

---

## 8. Agent briefs

Agent briefs live in `.claude/agents/`, one file each. Ownership of every path is the
table in `CLAUDE.md`, which is also the CODEOWNERS seed. Neither is duplicated here:
this section used to restate both, the copies drifted, and it instructed each agent to
write decisions back into itself — which turns a spec document into an append-only log
that every agent then pays to read on every invocation.

---

## 8b. The corpus lives in `proxlane/corpus`, and that has to be written down

`packages/detect/src/verified.ts` is generated: a rule appears there because a stored capture,
run through the real `detect()`, fired it. The captures stay out of this repo — a dated capture
of a named site's defences is what `plan.md` section 19 bars — so they live in the **private
`proxlane/corpus` repository**, cloned to wherever `PROXLANE_PRIVATE_CORPUS` points.

**That sentence did not exist until 2026-08-31, and its absence cost five true claims.** A
working directory on one machine held one of the nine captures. Nothing in the repo said where
the other eight were, so the conclusion drawn from an exhaustive search of that machine — Time
Machine, trash, `git fsck` — was that the evidence had been lost, and the table was cut from
five verified rules to two and published that way. The captures were in a private repo in the
same organisation, one `gh repo list` away. Restored the same day; the real state is 6 of 6.

The guard worked and was overridden. `corpus:verify --write` refused, named all five claims it
would retract, and said "your corpus is probably incomplete rather than the claims being wrong."
That is exactly what had happened. `--allow-retractions` exists for a claim genuinely being
withdrawn, and it was used on a wrong premise instead. A guard that names the right answer
cannot help if the person reading it is already sure.

So, in order of what would actually have prevented it:

- **Say where the corpus is.** Now said, here, and in `corpus:verify`'s own refusal text.
- **Clone it before concluding anything is missing.** `gh repo clone proxlane/corpus`.
- **`--allow-retractions` means you have checked the private repo**, not that you searched one
  laptop. Retracting a published claim is the most expensive thing this command can do.
- **Add a new capture to the repo, not only to a local directory**, or the next person to clone
  it regenerates a table that silently drops yours.

Re-capture, when it is needed, comes from live traffic that was blocked anyway — a purpose-built
sandbox cannot serve a vendor challenge, which is why `imperva-incapsula` waited for a real
caller to be blocked by Imperva and hand the page over.

## 9. Launch gates

**This is the launch checklist.** `plan.md` section 20 is the separate Phase-0 checklist
(things to do before writing code), section 5 describes the phases, and section 8 measures
outcomes after launch. There were four overlapping lists with no cross-references, so an
agent asked "are we ready" got four answers.

Nothing ships until all of these are true.

**Re-scoped 2026-08-23, and the reason is the point.** This list was written before the product
existed and gated on services that were then deliberately not built: a backup-restore drill for a
gateway with no database, and a status page for a thing with no hosted endpoint. `docker/compose.yml`
runs one service. Two items could therefore never go green, which meant there was no launch date
and could not be one — and every week the distribution work had a legitimate-looking reason to
slip. A gate that cannot close is not a standard, it is a permanent excuse.

What is struck is struck because the thing it tests was a *decision not to build*, not an
omission. Both return with the hosted tier, in phase 3, where they belong.

- [ ] `pnpm k6:soak` green against the thresholds in section 1 — 50 VUs for 30 minutes,
      gateway-internal p95 under 50 ms measured from `Server-Timing`, RSS slope under
      1 MB/min from minute 10, clean 429s at `maxInflight`. **Venue still undecided**
      (`state.md`): the shared box measures the neighbours, so this needs an ephemeral host
- [ ] `pnpm test:ssrf` green: scheme allowlist, private-range and metadata rejection at
      the edge, all returning `TARGET_FORBIDDEN`. IP pinning and DNS-rebinding cases are
      **out of scope for v1** and defer with the direct-fetch mode that would need them
      (section 5)
- [ ] Conformance green on **every shipped adapter** — four today, and the count is
      `REGISTRY`'s, not a number typed here — plus the live canary green three consecutive
      scheduled runs (cadence per `operating.md` B6 — weekly at launch, so three weeks).
      **The canary covers the adapters we hold a usable key for, and the launch record must
      name the ones it did not.** From 2026-08-31 that is ScraperAPI and Scrapfly, whose free
      quotas were exhausted recording fixtures on 08-27 and renew 09-07; both secrets are out
      of CI until then. With the key present and empty the canary reports "Scrapfly failed",
      which is false — the provider is fine and our wallet is not. With it absent the canary
      prints `NOTE: no key for scrapfly — those adapters were NOT checked`, which is true.
      A weaker gate that says so beats a stronger-looking one that misattributes.
      **This is a coverage note, not a licence to drop a provider that is actually failing.**
      A key that is present must go green; the exemption is for a provider we cannot call at
      all, and it expires the moment credit returns.
- [ ] `docker compose up` works on a fresh VM with only a provider key
- [ ] `proxlane doctor` diagnoses the five most likely misconfigurations
- [ ] SECURITY.md, CONTRIBUTING.md, LICENSE, CoC in place
- [x] **One stranger runs it.** Not twenty minutes of someone trying to break it — one person
      who is not the maintainer, on their own provider key, reporting what happened. This is the
      only item on the list that would have caught any of the 41 findings the copy panel raised,
      and it is the input every open question in `state.md` is actually waiting on.

      **Done, 2026-08-26 to 08-31**, and it earned its place at the top of this list. A caller
      running proxlane against production traffic on their own keys, reporting each time, found
      six defects in five days — every one of them invisible to conformance, to the canary as it
      then stood, and to any amount of the maintainer re-reading the code:

      1. the one executor dropped `wire.body`, so Bright Data answered `AUTH_FAILED` on a
         working key for the whole of phase 1 and the launch gate had never measured it (#237)
      2. the canary's 404 target returns zero bytes, which an unblocker cannot tell from a
         block (#237)
      3. `wait_for` did not exist, so a late-hydrating page returned the shell at random (#238)
      4. `HARD_BLOCK` never named the vendor, because the detector ran on every path but that
         one — and a vendor that always answers 403 could therefore never have its rule
         confirmed by live traffic (#243)
      5. `capture-block` left the target's host in the stored body while its own docstring
         promised otherwise (#243)
      6. an exhausted Scrapfly quota was filed as `PROVIDER_ERROR`, which sits in the
         cross-org health statistic, so one org's empty wallet could demote a provider for
         everyone (#246)

      Three weeks of a mechanical canary would have found none of them. Keep this item first.

**Struck, with the reason, so nobody re-adds them:**

- ~~Backup restore drill from a clean machine~~ — there is nothing to restore. No Postgres, no
  Valkey persistence (`save ""` by design), no ledger. Returns with the hosted tier.
- ~~Status page live, alerting to a phone~~ — a status page reports on a hosted service. Self-hosters
  have their own. Returns with the hosted tier.
- ~~Twelve SEO pages live~~ — 36 URLs are live and this gate never noticed, because a page count is
  not a launch condition. What matters is whether the pages target queries anyone searches, which
  `plan.md` section 6 ranks and which no checkbox can settle.
