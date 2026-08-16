# @proxlane/shared

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
