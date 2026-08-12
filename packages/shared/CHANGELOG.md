# @proxlane/shared

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
