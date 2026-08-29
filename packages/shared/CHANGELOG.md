# @proxlane/shared

## 0.10.0

### Minor Changes

- [#235](https://github.com/proxlane/proxlane/pull/235) [`b694712`](https://github.com/proxlane/proxlane/commit/b69471270c69894ccaa104214254e16e441cf97e) Thanks [@scarsam](https://github.com/scarsam)! - A Scrapfly response over 5MB no longer arrives as a URL marked `OK`. Scrapfly offloads bodies above that size to an object store and returns a pointer; `parse()` read it as the page, so the caller got 70 bytes with HTTP 200, the target's content-type and a charge. It is now `PROVIDER_BODY_OFFLOADED`, which fails over to a provider that returns the body inline.

## 0.9.0

### Minor Changes

- [#213](https://github.com/proxlane/proxlane/pull/213) [`a43b34e`](https://github.com/proxlane/proxlane/commit/a43b34e76ded21c2a2f623e02a2b7cae5fcbe4a3) Thanks [@scarsam](https://github.com/scarsam)! - Provider keys are trimmed when read from the environment. They were not, and the failure that
  produced is silent and expensive.

  `Headers` normalises TRAILING whitespace away, so a key ending in a space or a newline works —
  which is most accidents, and it teaches you whitespace is harmless here. A LEADING space
  survives: `Authorization: Bearer  <key>` goes out with two spaces, the provider answers 401, and
  that reaches the caller as `AUTH_FAILED` — a taxonomy member meaning "your credential was
  refused", pointing at the key's value when the value is correct and its framing is not.

  Only one of the four adapters could show it. The other three put the key in a query string,
  where `URLSearchParams` percent-encodes the space rather than sending it, so exactly one provider
  looked broken and the rest looked fine — which is the most misleading shape this could have had.

  `proxlane doctor` now says when a key had surrounding whitespace, because the gateway trimming it
  does not stop the same value confusing someone comparing their `.env` against what they pasted.

## 0.8.0

### Minor Changes

- [#194](https://github.com/proxlane/proxlane/pull/194) [`3302c1c`](https://github.com/proxlane/proxlane/commit/3302c1c4ce77e02926a5f50404db44f1c00a0421) Thanks [@scarsam](https://github.com/scarsam)! - A block no longer cools every premium tier. `cd:blk` now carries the tier the request asked for, so
  a plain request that gets blocked stops suppressing the stealth retry — the escalation most likely
  to work, and the reason the tier exists. The implication still runs downward: a block at stealth
  cools residential and plain too, because they are strictly weaker against the same defence.

  `/health/cooldowns` reports the tier. Existing armed keys are in the old format and are ignored
  rather than migrated; they expire on their own within the cap.

## 0.7.1

### Patch Changes

- [#188](https://github.com/proxlane/proxlane/pull/188) [`7e77a6d`](https://github.com/proxlane/proxlane/commit/7e77a6d09b470c77cdec25ff205d64f4bf930fb5) Thanks [@scarsam](https://github.com/scarsam)! - A challenge page served with a target 5xx is now recognised as a block instead of being reported as
  `TARGET_ERROR`. The detector only ever examined `OK` responses, so Cloudflare's under-attack mode —
  which answers 503 — came back as "the site is broken" when the truth was that the site's defences
  refused every provider. It also armed no cooldown, so every later request re-bought the same
  failures.

  A claimed success that returned zero bytes is no longer billed as a successful scrape.

- [#186](https://github.com/proxlane/proxlane/pull/186) [`4468690`](https://github.com/proxlane/proxlane/commit/4468690161f5e5c2b1f87d3839854d0f2849b07c) Thanks [@scarsam](https://github.com/scarsam)! - Every published package now has a description, keywords, a homepage and a README. Four of the five
  rendered "ERROR: No README data found!" on npmjs.com — including `@proxlane/adapters`, the
  Apache-2.0 package this project most wants strangers to contribute to.

- [#176](https://github.com/proxlane/proxlane/pull/176) [`292e67b`](https://github.com/proxlane/proxlane/commit/292e67b7fc1ec912a64910b88ae503e9b3180774) Thanks [@scarsam](https://github.com/scarsam)! - `orderChain`'s docstring described chain order backwards. Ranking best-first puts the least
  healthy provider last, and the docs already recorded that; the source comment and the test named
  after it still claimed the reverse, and that test asserted the opposite of its own title while
  passing. Behaviour is unchanged — the comment was wrong, not the code.

- [#183](https://github.com/proxlane/proxlane/pull/183) [`df7a4c0`](https://github.com/proxlane/proxlane/commit/df7a4c0ba816b444c970433ab0625147714ae81b) Thanks [@scarsam](https://github.com/scarsam)! - The edge guard now refuses three IPv6 forms that carried an IPv4 address past it: RFC 2765's
  IPv4-translated `::ffff:0:0/96`, RFC 8215's local-use NAT64 prefix `64:ff9b:1::/48`, and the five
  RFC 6052 embedding positions other than the well-known one. `http://[::ffff:0:169.254.169.254]/`
  reached the cloud metadata endpoint.

## 0.7.0

### Minor Changes

- [#156](https://github.com/proxlane/proxlane/pull/156) [`6b89f31`](https://github.com/proxlane/proxlane/commit/6b89f312b442b53d231141356124217438f14e53) Thanks [@scarsam](https://github.com/scarsam)! - A scraping API comparison at `/scraping-api-comparison`: pick a request shape and see what each
  provider charges on top of its own base rate, from their published tables. Compares multipliers,
  which are dimensionless, and never compares base rates across billing units. Fixes Bright Data's
  base cost, which was a hundred times too low — the only provider whose cost we estimate rather
  than read off the response. `@proxlane/shared` gains an `./error-body` subpath so `@proxlane/adapters`
  no longer drags `node:crypto` into anything that imports it.

### Patch Changes

- [#142](https://github.com/proxlane/proxlane/pull/142) [`d8f0661`](https://github.com/proxlane/proxlane/commit/d8f06614cc3c2279b06b222a85dc1f3524bfb048) Thanks [@scarsam](https://github.com/scarsam)! - The global deadline defaults to 120s, which `operations.md` decided some time ago and the
  gateway never picked up. At 90s a three-hop chain gave the terminal provider 38s of its 70s cap,
  because the budget reserves time for every hop still to come. The hop that exists to rescue a
  failing request was the one being cut short.

  Callers still ask for less via `timeout` and never for more. The operator's deadline is the
  ceiling, because it bounds how long one request holds an in-flight slot.

## 0.6.0

### Minor Changes

- [#136](https://github.com/proxlane/proxlane/pull/136) [`89f92ba`](https://github.com/proxlane/proxlane/commit/89f92ba1af670329d9eca3c15394f04a8803b6ee) Thanks [@scarsam](https://github.com/scarsam)! - A block cooldown that keeps failing now backs off to 6 hours instead of re-arming at a flat 15
  minutes forever. A (provider, domain) that had refused a hundred times running cost 96 paid
  probes a day, 288 for a domain three providers block, all of it re-buying evidence already
  held. Account cooldowns are unchanged: a rate limit resets on its own and is private to one org.

  Because a fully-blocked domain would otherwise go dark for the whole backoff, an all-cooling
  domain now gets one forced attempt, rate-limited per domain and reported as
  `X-Provider-Health: cooling-forced`.

## 0.5.0

### Minor Changes

- [#125](https://github.com/proxlane/proxlane/pull/125) [`fc0b684`](https://github.com/proxlane/proxlane/commit/fc0b684a60341478b09c45a6e2cf675109928497) Thanks [@scarsam](https://github.com/scarsam)! - Returning a body byte for byte is now a declared capability, and `binary=true` a request
  parameter. An image request used to return 200 with a corrupted body; it now routes only to
  providers that can carry bytes, or answers `NO_PROVIDER_AVAILABLE`. Three of the four launch
  providers carry binary. ScraperAPI does not — it decodes bodies as UTF-8, and its own API says
  so: `binary_target=true` answers 400, "The file type you are trying to scrape is not supported."

## 0.4.0

### Minor Changes

- [#111](https://github.com/proxlane/proxlane/pull/111) [`258e5fc`](https://github.com/proxlane/proxlane/commit/258e5fc227c795fa6fad07fd57734bfe3f05e5f2) Thanks [@scarsam](https://github.com/scarsam)! - `proxlane outcomes` now says what to do about an outcome, not only what it means: an `action`, a
  sentence of why, and a link to the class's docs section. The policy fields describe what the
  gateway does internally — `failover: true` on a blocked outcome means every provider was already
  tried — which is the opposite of what a caller reading it as "retryable" would conclude.

  Error responses and the CLI both link to `proxlane.dev/docs/outcomes`, which is live. They
  pointed at GitHub because `docs.proxlane.dev` has no DNS record; it was the subdomain that never
  existed, not the docs.

## 0.3.0

### Minor Changes

- abf833f: Add the docs site. `/docs` was linked from the header and the primary call to action and had
  no route at all, so both 404ed on the live site.

  Pages are markdown in `apps/web/content/docs`, versioned and reviewed like code, rendered to
  HTML at build time by a Vite plugin. Neither `markdown-it` nor Shiki reaches the Worker
  bundle. The outcome reference is generated from the taxonomy instead, because a hand-written
  copy of the thing callers write switch statements against is the one page that must not drift.

  `pnpm docs:check` is now real: it asserts every page has a file, a route and a nav entry,
  that every query parameter and response header the gateway implements is documented, that
  internal links resolve, and that `llms.txt` lists exactly the pages that exist.

  `@proxlane/shared` gains a `./outcome` subpath export, so the taxonomy can be imported
  without pulling the edge guard and `node:crypto` into a browser bundle.

- c48afba: Enforce the in-flight ceiling. Past `PROXLANE_MAX_INFLIGHT` concurrent `/v1` requests the
  gateway answers 429 `GATEWAY_BUSY` with `Retry-After` and sheds, rather than queueing —
  a queued scrape burns its own deadline waiting and the queue is memory the ceiling bounds.
  `/health` is never shed. The variable was documented since the scaffold and read by nothing.

  `GATEWAY_BUSY` is a new outcome, class `gateway`. Deliberately not `RATE_LIMITED`, which is
  class `provider`, writes an account cooldown and fails over — all three wrong when the
  gateway itself is full. `OutcomeClass` does not grow, so a caller branching on the class is
  unaffected.

- 4ed05a5: Check at boot that the gateway fits in the memory it has been given. It reads the container's
  limit from cgroup v2 then v1, and refuses to start when `maxInflight * bodyCap * 2.5` exceeds
  it, printing both numbers and the ceiling that would fit. It never falls back to
  `os.totalmem()`, which reports the host's memory inside a limited container.

  When no limit is readable, which is normal off a container, it prints the arithmetic and
  starts, so `pnpm dev` still works. `PROXLANE_MEMORY_LIMIT_MB` declares a limit where there is
  none and overrides one where there is. `proxlane doctor` reports the same budget from the same
  code. `.env.example` and `docs/self-hosting.md` described this check for months before it
  existed; both now describe what it does.

## 0.2.0

### Minor Changes

- 9e705a6: **Breaking:** every non-2xx now returns one envelope — `{requestId, error: {code, class, message, docs}, attempts?}` — instead of `{error, message}` for auth and validation and `{outcome, class, attempts}` for a failed scrape. Response headers are unchanged.
- baa3c0f: Add `OutcomeClass`, a closed six-member classification alongside the open `Outcome` union, and send it as `X-Outcome-Class` and in the JSON error body. Branch on the class: it does not grow, so adding an outcome no longer breaks callers.
- 9c93bb5: Every response now carries `X-Request-Id` and a matching `requestId` in the JSON body, including 401s and validation errors. A caller's own `X-Request-Id` is echoed when it is safe to. Adds `uuidv7`, monotonic and clock-regression-safe, which will also be `requests.id`.

## 0.1.0

### Minor Changes

- a8f8a3e: Cooldowns are implemented: two namespaces (`cd:blk` by domain, `cd:acct` by org), exponential backoff with full jitter and a 15-minute cap, and half-open expiry where the single post-expiry probe must be claimed atomically. The gateway skips cooled providers before dividing the deadline, and returns `Retry-After` when every capable provider is cooling.
- 0f19f27: Health tracking now defaults to off: its calibration assumes independent failures, and a two-regime provider with the same mean failure rate spends over 90% of its time demoted in simulation. Set `PROXLANE_HEALTH=on` to enable it. Every published figure has been regenerated from the simulation, and `repo:check` assertion 21 now fails when the prose drifts from the measurement.
- a611e21: `HealthState` now carries `enteredAt`, so the state a store persists is exactly the state the machine needs; `observe` and `observeProbe` take `now` and nothing else. `INITIAL` is replaced by `initial(now)`. Conformance requires the fixture categories that prove an adapter can tell a target failure from its own.
- 6429c21: Provider health as a CUSUM against each provider's own measured baseline: detects a slow success-rate slide that no single request's outcome can reveal, and exposes `observe`, `orderChain` and `eligible` for the router.
- 023530d: A cooldown now waits as long as the target's own `Retry-After` asks, when the provider exposes it — measured: ScrapingBee forwards it as `spb-retry-after`, Scrapfly exposes it in the envelope, ScraperAPI strips it. Clamped to the 15-minute cap, with the jittered backoff as the fallback.
- 6df863c: A target 429 is now `TARGET_RATE_LIMITED` rather than `TARGET_ERROR`: it returns 429 to the caller, fails over to a different egress, and arms the shared domain cooldown. Previously it armed nothing, so the next request retried immediately — which is what escalates a rate limit into a ban.
- 0e81564: The outcome taxonomy, `Outcome`, `FAILOVER` and `GatewayRequest` move from `@proxlane/adapters` to `@proxlane/shared`, so the base layer no longer depends on a leaf. `@proxlane/adapters` re-exports all of it, so adapter authors import exactly what they imported before.

### Patch Changes

- 48962c2: Corrects every published health figure that disagreed between files, removes three false citations from `health.ts` (including one reintroducing the exact defect that file documents), pins the five constants a mutation sweep found unpinned, and strengthens `repo:check` assertion 21 against the bypasses a verification panel demonstrated.
- 1dc6bc8: ScraperAPI now reads the target's status from `sa-statuscode` instead of matching body prose, and reports the real credit cost from `sa-credit-cost` — a rendered request previously billed at 1 credit instead of 10. A target returning 403 is now `HARD_BLOCK` rather than `AUTH_FAILED`, which had marked the caller's own key unhealthy.
- 520ae48: Security follow-ups: hostnames in cooldown keys are bounded to 253 characters, a trailing FQDN dot no longer creates a second key for the same site, the gateway key comparison uses `timingSafeEqual` rather than a length-short-circuiting loop, and `PROXLANE_ORG_ID` actually reaches the chain so `cd:acct` is namespaced per deployment.
- 8fb47d5: Valkey-backed health and cooldown stores, so more than one gateway replica can share routing state. Set `PROXLANE_VALKEY_URL` to use them; unset, both stay in-process and the server still refuses to boot with `PROXLANE_REPLICAS>1`.
