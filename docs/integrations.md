# Integrations Architecture

Integrations are the product. This doc defines how adapters are built, tested, and
maintained so that adapter #10 is as trustworthy as adapter #1, and so provider drift
is caught by machines, not angry users.

Design principle: **parse, don't assume; record, don't mock; one contract, many adapters.**

---

## 1. Provider intel (launch three)

What their APIs actually do, and the quirks that drive our design.

### ScraperAPI
- `GET https://api.scraperapi.com/?api_key=..&url=..`
- Params: `render`, `country_code`, `premium`, `ultra_premium`, `keep_headers`,
  `device_type` (desktop|mobile), `follow_redirect`, `wait_for_selector`, `screenshot`,
  `retry_404`, `output_format` (text|markdown), `autoparse`, sticky sessions.
- **Retries internally for up to 70s** before returning 500. Client timeout must be
  >= 70s or we kill requests they would have saved. Our per-attempt budget for this
  adapter: 75s.
- Billing: charged only on 200 and 404. 500 = failed, not charged.
- 429 = concurrency limit exceeded (plan-based), not a ban.
- **Known gap: can return 200 containing a CAPTCHA page** (they ask users to report
  these). Our soft-block detection must run on every "successful" response.
- Also offers: async job API with webhooks, structured-data endpoints, markdown output.
  Docs ship llms.txt and per-page markdown (nice for our own tooling).

### ScrapingBee
- `GET https://app.scrapingbee.com/api/v1/?api_key=..&url=..`
- **`render_js` defaults to TRUE** (5 credits). `render_js=false` = 1 credit.
  Opposite default from ScraperAPI. The adapter must set it explicitly, never rely
  on provider defaults.
- `premium_proxy=true` = 25 credits with JS, 10 without. `stealth_proxy=true` for the
  hardest targets (incompatible with some features, e.g. infinite_scroll).
- `mode=auto` lets ScrapingBee pick the tier, but **conflicts with explicit tier
  params: sending both returns 400.** `max_cost` caps what auto may spend.
- `wait` (ms), `wait_for` (CSS selector), `block_resources` (default true, can break
  pages), `js_scenario`, `transparent_status_code`.
- URL must be strictly URL-encoded; their #1 support issue is bad encoding.
- Errors: 401 invalid key, 403, 429 rate limit, 500 with the target's error detail
  in the body.

### Scrapfly
- `GET https://api.scrapfly.io/scrape?key=..&url=..`
- **Returns a JSON envelope by default** (result.content, result.status_code,
  headers, cookies, billing), not raw HTML. `proxified_response=true` returns the
  raw page. Adapter must unwrap the envelope and expose upstream_status_code
  separately from the API status.
- `asp=true` (anti-scraping protection) dynamically upgrades proxy pool and browser,
  **which changes the cost per request**. `cost_budget` caps it. We always set a
  cost_budget derived from the user's request tier.
- Rich response headers: `X-Scrapfly-Remaining-Api-Credit`,
  `X-Scrapfly-Reject-Code` (+ message headers) on rejects, concurrency remaining.
  Errors are flagged retryable/non-retryable by the API itself; honor that flag.
- Sessions persist cookies + fingerprint + proxy. Failed requests are not billed.
- Billing is reported in every response: this is the only launch provider giving us
  exact actual cost, so Scrapfly is the calibration reference for cost estimates.
- Bonus discovered: Proxy Saver lets users plug their own Bright Data/Oxylabs/etc.
  proxies into Scrapfly's API. Long-term this composes interestingly with BYOK.

### Design consequences from the three
1. Defaults differ per provider (render on/off) -> gateway semantics are explicit;
   adapters translate, never inherit provider defaults.
2. Success lies (ScraperAPI 200+CAPTCHA) -> validation runs after every adapter.
3. Cost is dynamic (Scrapfly ASP, ScrapingBee auto) -> cost is *reported* when the
   provider tells us, *estimated* from a versioned table when not, and the response
   marks which.
4. Timeout budgets are per-provider (70s ScraperAPI vs fast-fail others) -> the
   failover chain needs a global deadline independent of per-attempt budgets.
5. Param conflicts exist (ScrapingBee mode=auto) -> adapters validate the translated
   request with Zod before sending; impossible combinations fail loudly at our edge,
   not as provider 400s.

---

## 2. The adapter contract

One interface. Everything provider-specific lives behind it.

```ts
// packages/adapters/src/contract.ts — the adapter surface.
// The outcome taxonomy it re-exports lives in packages/shared/src/outcome.ts, so that
// `shared` can depend on nothing internal. See CLAUDE.md, package layering.

export interface GatewayRequest {
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  renderJs: boolean;              // explicit, no defaults leak through
  countryCode?: string;           // ISO 3166-1 alpha-2
  premium: PremiumTier;           // 'none' | 'residential' | 'stealth'
  sessionId?: string;
  headers?: Record<string, string>;
  deadlineMs: number;             // global; router derives per-attempt budgets
}

export interface ProviderCapabilities {
  id: ProviderId;
  renderJs: boolean;
  countryCodes: ReadonlySet<string> | 'all';
  premiumTiers: ReadonlySet<PremiumTier>;
  sessions: boolean;
  maxTimeoutMs: number;           // budget on the LAST hop, e.g. scraperapi: 75_000
  fastTimeoutMs: number;          // budget on a non-terminal hop, e.g. scraperapi: 22_000
  post: boolean;
  costTable: CostTable;           // versioned, see section 4
}

export interface ParsedResult {   // what the pure parse() returns
  outcome: Outcome;               // see error taxonomy
  body?: Uint8Array;              // wire bytes, after transfer-decoding, before charset decoding
  contentType?: string;
  charset?: string;               // response header -> <meta> sniff -> provider default
  upstreamStatusCode?: number;
  cost: { microcredits: number; source: 'reported' | 'estimated' };
}

export interface Exchange {       // assembled by the transport, not by the adapter
  result: ParsedResult;
  latencyMs: number;              // only the transport can know this
  providerRequestId?: string;
  raw: RawExchange;               // sanitized req/res for logging + fixtures
}

export interface Adapter {
  readonly capabilities: ProviderCapabilities;
  translate(req: GatewayRequest, key: string): ProviderHttpRequest; // pure
  parse(res: ProviderHttpResponse): ParsedResult;                   // pure
}
```

Rules:
- `translate` and `parse` are **pure functions**. All I/O goes through one shared
  `HttpTransport` owned by the gateway, not by adapters. This is what makes real
  testing possible: pure functions test against recorded bytes, transport tests
  separately, and nothing needs a mocked provider class.
- **`latencyMs` and `providerRequestId` live on `Exchange`, not on the parse result.**
  A pure function cannot measure elapsed time. Left on the result, the first implementer
  resolves it by passing a clock into `parse`, and the purity property — which the entire
  test strategy rests on — quietly ends.

### Bodies are bytes, not strings

`html?: string` cannot represent what v1 promises. The README's headline is "same
response", section 9 leans toward binary passthrough, and a JSON API, an image or a PDF
has no `html`. Three consequences, each of which has to be decided before a single
fixture is recorded:

- **Charset.** Scraped pages declare their encoding in a `<meta>` tag *inside the body*
  (Shift_JIS, windows-1251, latin-1 are all routine on real targets). A contract that
  hands `parse` a pre-decoded string makes mojibake unfixable downstream — and it
  corrupts `/detect`, which fingerprint-matches against the mangled text. Resolution
  order is response header, then `<meta>` sniff, then provider default, recorded in
  `charset` so it is auditable. Decoding is **one shared step outside adapters**;
  `/detect` receives `(bytes, charset)` and decodes for itself, so a mis-declared charset
  becomes a detect rule rather than silent corruption. `html` survives only as a derived
  convenience for the detector, never as the transport of record.
- **Compression is the transport's, not the adapter's.** undici decompresses
  `content-encoding`, so `parse` never sees gzip. Section 6's request for `parse()`
  fixtures covering "gzip edge cases" belongs to the transport tests instead.
- **Therefore fixtures record post-transfer-decoding, pre-charset-decoding bytes, plus
  all response headers.** This is the gate: **every fixture captured before this contract
  is settled is in the wrong format and has to be recaptured.** Record nothing until the
  contract compiles.

- Every provider response body is parsed with a **Zod schema per provider**. Parse
  failure = `PROVIDER_DRIFT` outcome, alerting us that their API changed. We never
  `as`-cast a provider payload.
- Capabilities are **data, not code**. The router, the docs site, and the /providers
  SEO pages all render from the same registry. Adding a capability to one provider
  updates routing, validation, and marketing pages in one commit.

## 3. Error taxonomy and failover semantics

Everything an attempt can produce maps to exactly one outcome. Failover behavior is
defined per outcome, centrally, never inside adapters.

| Outcome | Meaning | HTTP we return | Charge user? | Failover? | Cooldown | Page us? |
|---|---|---|---|---|---|---|
| `OK` | Real content, passed validation | upstream status | yes (hosted) | no | no | no |
| `SOFT_BLOCK` | 200 but our detector fired (rule ID attached) | 502 | no | yes | `blk` | no |
| `HARD_BLOCK` | Provider says blocked/banned | 502 | no | yes | `blk` | no |
| `TARGET_NOT_FOUND` | Genuine 404 (unless retry_404 semantics) | 404 | provider-dependent | **no** | no | no |
| `TARGET_ERROR` | Target site 5xx / DNS dead | 502 | no | yes, once | no | no |
| `PROVIDER_TIMEOUT` | Attempt exceeded per-attempt budget | 504 | no | yes | `acct`, short | no |
| `PROVIDER_ERROR` | Provider 5xx / infra failure | 502 | no | yes | `acct`, short | no |
| `RATE_LIMITED` | Provider 429 / concurrency cap | 429 + `Retry-After` | no | yes | `acct`, respect headers | no |
| `AUTH_FAILED` | Provider 401/403 on the key | 502 | no | yes | `acct`; mark key unhealthy, notify user | no |
| `PROVIDER_DRIFT` | Response failed schema parse | 502 | no | yes | no | **yes** |
| `INVALID_REQUEST` | **Our translation** produced a provider 400 | 500 | no | **no** | no | **yes** |
| `BAD_REQUEST` | The client's request is malformed or impossible | 400 | no | **no** | no | no |
| `TARGET_FORBIDDEN` | Target rejected at our edge (private range, denylist) | 403 | no | **no** | no | no |
| `NO_PROVIDER_AVAILABLE` | No adapter matches, or the chain is exhausted | 503 | no | n/a | no | no |
| `RESPONSE_TOO_LARGE` | Body exceeded the cap | 413 | no | no | no | no |
| `BUDGET_EXCEEDED` | Global deadline or cost budget hit | 504 | no | no | no | no |

**Health attribution is a property of the (provider, outcome) pair, not the outcome alone.**

`PROVIDER_ERROR` feeds the **global** health statistic while `TARGET_ERROR` carries no
health weight. So whether a provider can distinguish "the target is broken" from "I am
broken" decides whether one popular dead target can push a healthy provider toward demotion
**for every org** — the cross-org contamination the two cooldown namespaces exist to
prevent, arriving through outcome attribution instead.

All three launch providers can, in fact, distinguish it, each in its own way:

| provider | discriminator |
|---|---|
| ScrapingBee | `spb-initial-status-code` header |
| Scrapfly | presence of the `result` key in the JSON envelope |
| ScraperAPI | `sa-statuscode` header |

**A correction, recorded rather than quietly edited.** This section previously asserted that
ScraperAPI could *not* distinguish them — "nothing in the status, the headers or the body" —
and an adapter matched on body prose because of it. That was wrong. What was actually
measured was that the two BODIES are byte-identical, which is true; the generalisation to
the headers was never checked, and `sa-statuscode` was present on every fixture already
recorded. `sa-credit-cost` was there too, so the same adapter under-reported a rendered
request's cost by 10x while a test asserted the provider reported no cost at all.

The lesson is narrower than "check the headers": a measurement was taken, a broader claim
was written down, and the gap between them survived review because the claim sounded like
the measurement. The remaining open question is genuine but smaller — whether attribution
should be modelled per (provider, outcome) in the taxonomy, or left to each adapter.

**The client-error class did not exist, and its absence pages the on-call.**
`INVALID_REQUEST` means *we* generated a bad provider request, which is a real bug worth
waking someone for. Everything else in the old table was a provider fact. Nothing covered
a request that is simply wrong, so all of it landed on `INVALID_REQUEST`:

- A target rejected at our edge — `operations.md` section 5 requires rejecting
  `http://localhost:8080` — had no outcome. **Anyone could page us with one curl.** It is
  now `TARGET_FORBIDDEN`, kept distinct from `BAD_REQUEST` so abuse is measurable.
- `provider=doesnotexist`, a forced provider lacking a requested capability, a malformed
  `url` (ScrapingBee's documented number-one support issue): `BAD_REQUEST`.
- `render=true` with no eligible adapter, and section 5's "list exhausted", had **no
  defined outcome at all** — the router had no value to return. Now
  `NO_PROVIDER_AVAILABLE`.
- Oversized bodies used to reuse `BUDGET_EXCEEDED`, which also means deadline. Split out
  as `RESPONSE_TOO_LARGE`.

The HTTP column is not decoration: the product's promise is drop-in compatibility, so the
status a client sees is part of the public surface, and no document defined it.

Notes:
- `TARGET_NOT_FOUND` never fails over: a real 404 on provider A is a real 404 on
  provider B, and retrying it burns money. (ScraperAPI charges for 404s.)
- Scrapfly's own retryable flag is mapped in, not overridden.
- Every response carries `X-Outcome`, `X-Provider-Used`, `X-Attempts`,
  `X-Detect-Rule`, and `X-Provider-Health` when a provider served, so users can self-serve
  debug. `GET /health/providers` returns the router's opinion of each provider and **takes
  the gateway key**: `/health` reports a count and no names because it is unauthenticated,
  and an open endpoint listing them would undo that.

### Cooldowns: two namespaces, because one conflates two facts

Keying every cooldown `(provider, domain)` makes one org's account problems everyone
else's. A block is a property of the **domain** and should be shared — that is the moat.
A rate limit is a property of one org's **account**: section 1 records that ScraperAPI's
429 is a plan-based concurrency cap, not a ban. Under a single key, org A saturating its
own concurrency cools that provider for **every other org**, so the hosted instance
degrades under exactly the load it exists to absorb.

| Key | Outcomes | Scope | Lifetime |
|---|---|---|---|
| `cd:blk:{provider}:{domain}` | `SOFT_BLOCK`, `HARD_BLOCK` | shared across orgs; feeds the scoreboard | 15 min cap |
| `cd:acct:{org}:{provider}` | `RATE_LIMITED`, `AUTH_FAILED`, quota exhaustion | private to one org | 15 min cap |
| `hs:{provider}` | `OK`, `PROVIDER_ERROR`, `PROVIDER_DRIFT` | shared across orgs | hours to days |

**There is no per-`domain-class` health key, and that is a decision rather than an
omission.** An earlier design had `hs:{provider}:{domain-class}` carrying the block signal,
but `domain-class` is defined nowhere and per-class baselines need volume per class that no
deployment has yet. Shipping the key implied and inert is worse than not shipping it: it
reads as coverage. Blocks route to `cd:blk` for phase 1, exactly as they do today. Revisit
with the phase-2 rollup, when there is data to define classes from.

Duration is exponential with **full jitter** and a **15-minute cap**, and expiry is
**half-open**: the first request after expiry is a probe, and a failed probe re-arms at
the cap. Without a probe, and with a static list and no epsilon exploration until phase 3,
a cooled provider has no path back before its cooldown expires.

**Valkey is a hard hot-path dependency in a product that sells reliability, in a compose
with no HA, so state what happens when it is unreachable:**

| Read | On failure |
|---|---|
| cooldown lookup | **fail open** — route as if not cooled |
| scoreboard lookup | **fail open** — fall back to the static priority list |
| org concurrency bucket | **fail closed** — 429 |
| org spend cap / balance | **fail closed** — 402 |
| `hs:` health lookup | **fail open** — route as if healthy |

`hs:` is the only one of these whose loss changes ROUTING rather than costing a wasted
attempt, which is worth saying out loud given Valkey runs without persistence. A cold start
loses every baseline and every provider re-enters measurement: no detection for
`MIN_SAMPLES` observations each, and no demotions carried over. That is the correct failure
direction — a gateway that forgets a provider was demoted routes to it again, whereas one
that forgets it was healthy would not.

The rule is that failing open may cost us a wasted attempt; failing open on a spend
control costs money we cannot recover.

### Provider health: is this provider worse than it usually is?

A different question from the routing scoreboard, which asks "which provider is best for
this domain" and is phase 3. Health is self-referential — each provider against its own
recent past — so it needs no cross-provider join and no rollup.

It exists because **every cooldown trigger above is a single request's outcome**. A provider
that slid from 96% to 74% success over hours trips none of them: at 74% no individual attempt
says "this is dying", only the rate does, and nothing read the rate.

`packages/shared/src/health.ts` is the executable form of this, and its constants are
derived by `scripts/health-sim.ts`, which imports the shipped functions rather than a copy.
**The numbers below are measured, not chosen.** Do not edit one without rerunning the sim.

**Attribution is per-outcome.** That is sound only because every adapter already discharges
the provider-specific part in `parse` — all three launch providers can tell a target failure
from their own (`sa-statuscode`, `spb-initial-status-code`, Scrapfly's `result` key). So by
the time an `Outcome` exists, "whose fault" is answered.

| Counts toward | Outcomes |
|---|---|
| the success term | `OK` |
| the failure term | `PROVIDER_ERROR`, `PROVIDER_DRIFT` |
| nothing — a property of a hop, not a provider | `PROVIDER_TIMEOUT` |
| nothing — target facts, handled by `cd:blk` | `SOFT_BLOCK`, `HARD_BLOCK`, `TARGET_NOT_FOUND`, `TARGET_ERROR` |
| nothing — account facts, handled by `cd:acct` | `AUTH_FAILED`, `RATE_LIMITED` |
| nothing — ours or the client's | `INVALID_REQUEST`, `BAD_REQUEST`, `TARGET_FORBIDDEN`, `NO_PROVIDER_AVAILABLE`, `RESPONSE_TOO_LARGE`, `BUDGET_EXCEEDED` |

`PROVIDER_TIMEOUT` is excluded despite being a provider fact. It is a property of a provider
*at a hop*: section 5 gives a non-terminal attempt 22 s and a terminal one 75 s. Degrading a
provider moves it down the chain, which shortens its budget, which raises its timeout rate,
which feeds the statistic that degraded it. The cost is real — a provider dying purely by
slow-then-timeout is caught late — and phase 2 can readmit it normalised by hop budget.

**What enforces that table**: `AUTH_FAILED` and `RATE_LIMITED` are excluded because launch is
BYOK, so one org's lapsed key must never demote a provider for every other org. A unit test
pins all sixteen outcomes against the union, so adding one fails until somebody decides what
it means. `TARGET_ERROR` is enforced end to end by a required conformance fixture.
`PROVIDER_ERROR` is **not**, and cannot be: it needs a provider 5xx, which is no more
summonable than a Cloudflare challenge. That half rests on review.

#### The statistic

A one-sided **CUSUM** on the failure indicator against a **frozen** baseline `p0`, not two
live EWMAs. A fast window against a slow live baseline is the obvious design and it fails
exactly where it matters, because the baseline chases the slide — of a real 0.22 drop it sees
0.217 over a 1,000-sample ramp but only 0.055 over 120,000. The slower the decay, the less a
live baseline can see of it.

`p0` is **measured from each provider's own first `MIN_SAMPLES` observations**, as a Wilson
upper bound rather than a plain rate. Both halves of that were arrived at by rejecting
something:

| design | healthy providers falsely demoted within 20k samples |
|---|---|
| fixed 5% bootstrap | a 10%-failure provider demoted after a median of 430 samples |
| measured, plain rate | 18.3% / 16.3% / 16.3% / 17.3% at true rates 2 / 4 / 10 / 20% |
| measured, Wilson upper bound | 0.0% / 0.0% / 0.3% / 3.0% |

Under-estimating `p0` is unrecoverable — the provider sits permanently above its own baseline
and the statistic ratchets — while over-estimating only costs sensitivity. The estimator is
asymmetric for that reason, and it costs four samples of detection delay.

**A note on how the second row survived review for a while:** the summary being read was the
MEDIAN run length, which said 589,863 samples to a false demote. The distribution is heavy
tailed, so the median said nothing about the 16% demoting inside 20,000. The sim reports
rates and a hazard now, never a median.

#### The state machine

```
healthy   -- CUSUM crosses H_DEGRADE                        --> degraded
degraded  -- statistic continues past H_DEMOTE              --> demoted
degraded  -- RESET_WINDOWS consecutive windows below
             H_RESET, and dwell >= DWELL_RECOVER            --> healthy, p0 re-measured
demoted   -- PROBE_CLEAN consecutive clean background
             probes; NEVER live traffic                     --> degraded, re-entered at
                                                                H_DEGRADE
```

Four edges, and the third is mandatory rather than nice to have: `p0` is frozen while
degraded, so without a path back the first provider that ever degrades keeps a baseline
against a rate that has since become fiction, and a one-sided statistic against a stale-high
`p0` re-trips forever. `p0` is re-measured on recovery rather than resumed, which costs a
`MIN_SAMPLES` window with no detection. That window is the price of not carrying forward a
number describing a provider that no longer exists.

Recovery from `demoted` is probe-only. The half-open cooldown above spends a real user's
request on a known-dead provider every 15 minutes, which is right for a transient block and
actively harmful across a three-day outage — roughly 288 wasted requests per domain per day.
Probe backoff runs 5 minutes to a 6-hour ceiling, so a dead provider costs at most four
probes a day.

**Which key the probe uses, resolved.** This was filed as blocking on the grounds that
"launch is BYOK and the gateway holds no house keys, so a demoted provider can never
recover". That was wrong about launch. Self-host is **one operator, one process, provider
keys in its own environment** — the gateway already holds a usable credential, and the
operator already pays for every attempt it makes. So the probe uses the configured key,
against the same stable targets `pnpm record` uses, at roughly one credit per probe and at
most four a day per demoted provider.

It is **opt-out, not opt-in** (`PROXLANE_HEALTH=off`): a provider that can never recover is
a far worse default than a handful of credits.

The rejected alternative is a shadow attempt on real traffic. Under BYOK it spends the
operator's money on a duplicate of an arbitrary request — ten credits if that request
rendered JS, against one for a probe — and it is non-deterministic, so a failed shadow tells
you less. The genuine consent-and-cost question, *whose* key pays to probe on everyone's
behalf, only exists with multiple tenants. That is hosted, and it is phase 3.

#### Routing consumes it

Rank by `(state, static priority)` and let position fall out. "Never put a degraded provider
in the terminal hop" is unsatisfiable the moment two of three are degraded — and two
simultaneous degradations is precisely the correlated scenario this exists for. The invariant
that survives every configuration is **the terminal hop is the least-degraded member of the
chain**, which matters because section 5 gives that hop 75 s against everyone else's 22 s.
Moving the least reliable member there is a promotion.

**Demotion has a floor.** Section 5 filters by capability first, so a correlated false
positive can empty the chain and return `NO_PROVIDER_AVAILABLE`. If demotion would leave zero
capable providers, the best demoted one is used and the response carries
`X-Provider-Health: demoted-forced`. A gateway that turns itself off is worse than one
routing at 74%.

#### Where it lands, at the pinned constants

- One false demote per ~54M observations per provider. At 50,000 attempts/day, one every
  2.9 years.
- The motivating incident — 96% to 74% over a 1,000-sample slide — is demoted at 877.
- Under 1% of steady healthy providers falsely demoted within 20,000 samples.

## 4. Cost accounting

- `CostTable` per provider, versioned in code with an effective date, expressed in
  microcredits (1 credit = 1_000_000). Base cost + multipliers (renderJs,
  premium tier, per-domain overrides).
- When the provider reports actual cost (Scrapfly headers/envelope), we store
  `reported` and diff against our estimate. Sustained drift > 10% on any
  (provider, feature) pair opens an alert: our table is stale.
- Estimates power: dashboard cost analytics for BYOK users, routing decisions,
  and hosted billing later. Hosted billing only ever charges on `OK`.

## 5. Routing and the failover chain (v1)

- Static priority list per premium tier, filtered by capability match
  (need renderJs -> only adapters with renderJs).
- Chain stops on: `OK`, `TARGET_NOT_FOUND`, `BAD_REQUEST`, `INVALID_REQUEST`,
  `TARGET_FORBIDDEN`, `BUDGET_EXCEEDED`, or list exhausted, which returns
  `NO_PROVIDER_AVAILABLE`.

### Budget must be reserved per remaining hop

`min(provider maxTimeout, remaining)` makes the three-attempt chain impossible on the
exact failure it exists for. ScraperAPI's per-attempt budget is 75s (section 1), the
global default was 90s, and default N is 3. A timeout on attempt 1 consumes 75 of 90s;
attempt 2 gets 15s — enough to fail, not enough to succeed on a hard target; attempt 3
gets nothing and returns `BUDGET_EXCEEDED`. **Shipped defaults degraded to roughly 1.5
attempts**, which also puts the README's three-provider reliability claim out of reach.

```
MIN_USEFUL_ATTEMPT_MS = 8_000
reserve(hopsLeft)     = hopsLeft * MIN_USEFUL_ATTEMPT_MS
cap                   = isLastHop ? provider.maxTimeoutMs : provider.fastTimeoutMs
perAttempt            = clamp(min(cap, remaining - reserve(hopsLeft)),
                              MIN_USEFUL_ATTEMPT_MS, cap)

if remaining < MIN_USEFUL_ATTEMPT_MS:
    BUDGET_EXCEEDED — do not open a connection for an attempt that cannot succeed
```

Non-terminal attempts are capped at `fastTimeoutMs`, which promotes section 9's "fast
mode" open question to the default: we trade ScraperAPI's internal retries for our own on
every hop but the last, where they get their full 75s. With the global default raised to
**120s** (`operations.md` section 1), the default chain is 22 + 22 + 75 = 119s, so N=3
fits. Clients set their own via the `timeout` param.

### The logged grain is the attempt, not the request

A `requests` row records only the **winning** provider. A request that goes
ScraperAPI→blocked, ScrapingBee→OK writes `provider_used=scrapingbee, attempts=2`, and
ScraperAPI's block on that domain — the single most valuable datum the product produces,
what `/targets/` pages and cost-aware routing are built from — **is not a queryable
fact**. `operations.md` section 4's alert on "provider X served zero successful requests
in N minutes" is likewise unanswerable: a provider blocked 100% of the time looks
identical to one that was never tried.

So attempts are rows:

```
requests          id (uuidv7), org_id, domain, url_hash, outcome, provider_used,
                  attempts, total_latency_ms, cost_micro_total, created_at
request_attempts  request_id, seq, provider, outcome, detect_rule, upstream_status,
                  latency_ms, cost_micro, cost_source, started_at
```

`requests` keeps the denormalised winner for the dashboard's list view; the scoreboard,
the per-request timeline, and the ledger's billable unit all read `request_attempts`.
Rollups aggregate from attempts.

**This is the one table that cannot be reshaped after it has traffic.** Get it right
before the first request is logged. Schema and partitioning live in `plan.md` section 3;
the earlier claim here that a JSONB attempt breakdown "feeds the scoreboard later without
a schema change" was wrong, and `plan.md` never had a JSONB column, so the two documents
had already disagreed.

---

## 6. Testing strategy (no mocking the whole world)

Four layers. The only thing ever faked is the network boundary, and it is faked
with **recorded real traffic**, not hand-written mocks.

### Layer 1: Pure unit tests (PR-blocking, milliseconds)
- `translate()`: gateway request in -> exact provider URL/params/headers out.
  Table-driven, covers every param and every illegal combination (e.g. ScrapingBee
  mode=auto conflicts).
- `parse()`: **real captured provider responses** (bytes on disk, keys redacted) in
  -> AdapterResult out. Fixtures include: success, 200+CAPTCHA page, provider 500,
  429 with headers, Scrapfly reject envelope, truncated body, gzip edge cases.
- `/detect` heuristics: corpus of real block pages (Cloudflare, DataDome,
  PerimeterX, consent walls) and real legit pages. Every rule has fixtures for both
  fire and no-fire. Regression corpus only grows.

### Layer 2: Contract replay tests (PR-blocking, fast)
- A `ReplayTransport` implements `HttpTransport` by serving recorded exchanges
  (HAR-like JSON: request fingerprint -> response). Records are produced by a
  `pnpm record` script that hits the **real APIs** with trial keys against stable
  targets (httpbin.dev endpoints, a static page, a JS-required page), then
  sanitizes secrets automatically before writing.
- These tests run the full gateway request lifecycle (router + adapter + detector +
  logging) against replayed reality. No provider class is ever mocked; the recorded
  bytes are the contract.
- Re-recording is one command; diffs in recorded responses show provider changes in
  code review.

### Layer 3: Live canary suite (scheduled + pre-release, not PR-blocking)
- Selected by **filename** (`*.live.test.ts`) and its own Vitest project, not by tag — a
  tag filter is one typo from burning real provider keys on a fork PR, and `repo:check`
  assertion 9 enforces the separation. Runs every adapter against real provider APIs with
  real keys
  (GitHub Actions secrets), against: httpbin.dev/html, httpbin.dev/status/{404,500},
  a JS-rendering test page, and one gently protected page.
- Asserts outcomes, not exact bytes. Failures open a GitHub issue automatically
  labeled `provider-drift` with the provider name.
- This is the machine that catches "ScrapingBee changed a default" before users do.
- Budget: trial/starter accounts, ~50 requests/provider/night. Cost of doing
  business; also keeps our affiliate-partner accounts warm.

### Layer 4: End-to-end (PR-blocking, seconds)
- Testcontainers: **real Postgres + real Redis** in Docker per test run. No DB
  mocks, no in-memory fakes with different semantics.
- Boots the actual Hono app, drives it over HTTP with the ReplayTransport wired in.
  Covers: auth, key encryption round-trip, failover across two providers, request
  logging, cooldown behavior, response headers.

### The conformance suite (what makes this scale)
- `packages/adapters/conformance/`: one shared Vitest suite, parameterized by
  adapter. Asserts the contract: every GatewayRequest permutation translates
  without leaking provider defaults, every fixture category parses to the right
  outcome, capabilities are honest (declared renderJs -> live canary proves it).
- **A new adapter is: implement the interface + record fixtures + pass conformance.**
  The contribution guide is literally "make `pnpm conformance --adapter=yours` green".

**What conformance cannot do, stated plainly.** "Community adapters arrive pre-verified"
was false, and believing it would have let unverified adapters merge:

- The honesty check — declared `renderJs` proved by the live canary — needs real provider
  keys, and **GitHub Actions does not expose secrets to fork PRs**. The one check that
  touches reality cannot run on a community PR.
- CI cannot distinguish a recorded fixture from a fabricated one. "Never hand-write a
  fixture" is a review norm backed by the `record:diff` job, not something a machine
  enforces.

So: **merging a community adapter requires a maintainer running the canary on house
keys.** Conformance makes that review cheap and mechanical, which is the real claim, and
it is still a strong one.

### The consumer's side, which none of the above covers

Layers 1–4 test **us**. Nothing above lets someone building on proxlane test **their** error
handling, and the taxonomy makes that structural rather than a missing nicety: there are 16
outcomes, a caller must handle them, and **they cannot produce most of them on demand.**
Nobody can summon a `SOFT_BLOCK`, force a provider 429, or arrange a failover chain to
exercise a retry path. It is the same wall the recorder hits — `pnpm record` ships no block
or captcha target for exactly this reason.

Two things close it. Neither is built; both are specified here so they are not invented
twice, in different shapes, by whoever reaches them first.

**`@proxlane/sdk/testing`, a subpath export of the SDK (Apache-2.0, phase 1).** Per-outcome
response builders, an in-process fake client, and MSW handlers for callers who test at the
HTTP layer. `outcomes.softBlock({ ruleId })` yields a response carrying the same status,
`chargeable` and failover semantics the gateway really produces.

**Sandbox mode on the gateway, `X-Proxlane-Simulate: <OUTCOME>` (phase 2).** Returns the
canned response for that outcome with the real `X-Outcome` / `X-Provider-Used` /
`X-Attempts` / `X-Detect-Rule` headers, having made **zero provider requests**. That is what
makes a consumer's CI deterministic and free.

**Both are GENERATED from `FAILOVER`, and that is the entire reason they are permitted** —
see the rule directly below, which they would otherwise break. A builder derived from the
same table the router consults cannot drift from it, and `contract.unit.test.ts` already
diffs that table against section 3. A hand-maintained mock of a 16-member taxonomy is stale
within one release and teaches callers to handle outcomes the gateway no longer emits.

**One security property, far cheaper to design in than to retrofit.** Simulation is honoured
only for a distinct test-key class. A live key sending `X-Proxlane-Simulate` gets a loud
`BAD_REQUEST`, never a silent ignore: ignoring it means a caller believes they are testing
while spending real credits, which is the failure this whole document is arranged against.

### What we deliberately do not do
- No mocked provider SDKs (we don't use their SDKs at all; raw HTTP only).
- No hand-written fake responses (drift magnet; fixtures come from recordings). The
  consumer-facing simulators above are **derived from `FAILOVER`**, not written by hand —
  that is the distinction, and it is the only reason they are not an instance of this.
- No mocking Postgres/Redis (testcontainers is cheap and honest).
- No snapshot tests on HTML bodies (brittle); assert extracted facts and outcomes.

---

## 7. Tooling (repo-wide, production posture from day one)

| Concern | Tool | Config notes |
|---|---|---|
| Language | TypeScript strict | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` |
| Lint + format | Biome | one config at root; CI fails on diff |
| Validation | Zod | env config, gateway params, every provider response schema |
| Tests | Vitest `projects` (the v3+ API; `workspace` is gone) | unit/contract/e2e/live, each selected by filename with `passWithNoTests: false`; the live project is invoked only by `pnpm test:live` |
| Test infra | Testcontainers | versions pinned in `CLAUDE.md`, matching the compose file |
| Runtime | Node LTS | major pinned in `CLAUDE.md`; see the Node vs Bun decision in `plan.md` |
| HTTP | undici via `HttpTransport` | per-adapter `headersTimeout` / `bodyTimeout` / pool size; the reason we are on Node. Depend on the **standalone `undici` package**, not Node's bundled copy, so the tuning is reproducible across runtimes |
| Build | tsdown (packages), Vite (web) | ESM only |
| Monorepo | pnpm + turborepo | remote cache later |
| DB | Drizzle + drizzle-kit | migrations in repo, `db push` forbidden in CI |
| Logs | pino | structured; request_id through every layer |
| Errors | typed Outcome + neverthrow-style results in core | exceptions only at the edge |
| CI | GitHub Actions | matrix: typecheck, lint, unit+contract, e2e; scheduled: live canary + re-record diff report, cadence per `operating.md` B6. PR builds amd64 natively; **arm64 only in the release workflow on a native arm64 runner** — buildx under QEMU is 5-10x slower on a Node build and breaks the ten-minute CI rule |
| Deps | Renovate | weekly, auto-merge patch |
| Versioning | Changesets | published to npm: `@proxlane/sdk`, `@proxlane/adapters`, `@proxlane/detect`, `@proxlane/shared` and the unscoped `proxlane` CLI. Everything else is `private: true` — `release:dry` cannot infer this set, so `repo:check` asserts no publishable package depends on a private one |
| Secrets | env + libsodium sealed provider keys | `.env.example` exhaustive; boot fails fast on invalid env via Zod |
| Observability | OpenTelemetry hooks in transport + router | exporter optional; self-hosters get it free |

CI gates on PR: typecheck, Biome, unit, contract replay, e2e. Nothing merges red.
Scheduled: live canary, cost-table drift check, re-record with diff artifact.
**Cadence is defined once, in `operating.md` section B6**, and referenced everywhere
else. It was previously stated in seven places, three of which disagreed.

---

## 8. Adapter authoring guide (outline for CONTRIBUTING)

1. `pnpm new-adapter <id>` scaffolds: capabilities file, translate/parse stubs,
   Zod response schema, fixture directory, conformance registration.
2. Get a trial key. Run `pnpm record --adapter=<id>` to capture the fixture set
   (script drives the standard target matrix and sanitizes).
3. Implement translate/parse until `pnpm conformance --adapter=<id>` is green.
4. Add cost table with source link (provider pricing page) and effective date.
5. PR checklist enforces: fixtures present, conformance green, capabilities honest,
   cost table sourced, docs page generated from registry renders.

Time to build an adapter once the kit exists: a focused day, most of it recording
and studying quirks. That is the scalability story: the kit front-loads the rigor.

---

## 9. Open questions

**Resolved above, because fixtures cannot be recorded until they are:**

- *ScraperAPI's 70s internal retry vs our failover.* Resolved: `fastTimeoutMs` on every
  non-terminal hop (22s for ScraperAPI), `maxTimeoutMs` on the last. See section 5. Still
  worth measuring which wins per domain class once there is traffic, but the default is
  no longer an open question — the chain does not work without it.
- *Binary responses in v1.* Resolved: pass through. `ParsedResult.body` is a
  `Uint8Array`, so there is nothing special about a PDF or an image; detection runs only
  when `contentType` is textual. Size cap is **10 MB**, defined once in `operations.md`
  section 1 — this section previously said 5 MB and the two disagreed.
- *Gzip.* Resolved: the transport owns `content-encoding`; adapters never see it.

**Still open:**

- Response streaming to the client vs buffer-validate-forward: v1 buffers (detection
  needs the body); revisit for large responses. Note the memory arithmetic in
  `operations.md` section 1 — buffering is what bounds concurrency.
- ScrapingBee `mode=auto`: expose as gateway `premium=auto` mapped only to providers with
  an equivalent, or keep tier selection entirely on our side? Leaning: our side, one
  brain not two. But note what `auto` now actually does — it tries configurations
  cheapest to most expensive, **charges only for the one that works, and charges zero if
  all fail**. That is intra-provider escalation with pay-per-success, which means two
  things: comparison pages must not imply ScrapingBee lacks cost-escalation logic, and
  our cost table has to model `auto`'s real billing or BYOK cost analytics will be
  visibly wrong for anyone using it.
- **Firecrawl — resolved 2026-08-07 against their live API docs. It does not block the
  contract.** This entry previously said the decision had to be made "before the adapter is
  written" and was being read as blocking `contract.ts`. It is not, for three reasons.

  **`/scrape` already fits `GatewayRequest` exactly.** It is synchronous, one URL in, one
  response out. Markdown is not a different shape — it is a value in a `formats` array,
  alongside `html`, `rawHtml`, `links`, `screenshot` and `json`. So "flatten to `scrape`,
  losing what people actually use them for" was wrong: flattening loses nothing about
  markdown, which is the thing people actually use them for.

  **What does not fit is not a wider registry, it is a different product.** `/crawl`
  returns a job `id` and you poll it or receive webhooks (`crawl.started`, `crawl.page`,
  `crawl.completed`). Nothing in this gateway means anything for that lifecycle: the global
  deadline, the per-attempt budget reservation in section 5, the failover chain, and "one
  response out" all assume a request that completes. A job API is not a capability flag on
  a proxy, it is a second product with its own persistence, its own billing grain and its
  own failure semantics.

  **So the real question is a phase-3 product question**, not a contract-shape one: *does
  Proxlane ever offer a job API?* That can be answered when it is relevant. Until then the
  registry stays as it is, and a Firecrawl adapter — when it is written, at adapter #8–10
  per `plan.md` section 5, not at launch — exposes `/scrape` and nothing else.

  At `0.x` a later widening is a minor bump, so designing the registry now for one
  hypothetical provider is exactly the speculative generality `plan.md` section 9's
  scope-creep rule exists to prevent. See `plan.md` section 9 for why they are also a
  competitor.
