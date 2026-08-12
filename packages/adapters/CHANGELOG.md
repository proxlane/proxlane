# @proxlane/adapters

## 0.2.0

### Minor Changes

- 9e705a6: **Breaking:** every non-2xx now returns one envelope — `{requestId, error: {code, class, message, docs}, attempts?}` — instead of `{error, message}` for auth and validation and `{outcome, class, attempts}` for a failed scrape. Response headers are unchanged.
- baa3c0f: Add `OutcomeClass`, a closed six-member classification alongside the open `Outcome` union, and send it as `X-Outcome-Class` and in the JSON error body. Branch on the class: it does not grow, so adding an outcome no longer breaks callers.

### Patch Changes

- Updated dependencies [9e705a6]
- Updated dependencies [baa3c0f]
- Updated dependencies [9c93bb5]
  - @proxlane/shared@0.2.0

## 0.1.0

### Minor Changes

- a611e21: `HealthState` now carries `enteredAt`, so the state a store persists is exactly the state the machine needs; `observe` and `observeProbe` take `now` and nothing else. `INITIAL` is replaced by `initial(now)`. Conformance requires the fixture categories that prove an adapter can tell a target failure from its own.
- 023530d: A cooldown now waits as long as the target's own `Retry-After` asks, when the provider exposes it — measured: ScrapingBee forwards it as `spb-retry-after`, Scrapfly exposes it in the envelope, ScraperAPI strips it. Clamped to the 15-minute cap, with the jittered backoff as the fallback.
- 6df863c: A target 429 is now `TARGET_RATE_LIMITED` rather than `TARGET_ERROR`: it returns 429 to the caller, fails over to a different egress, and arms the shared domain cooldown. Previously it armed nothing, so the next request retried immediately — which is what escalates a rate limit into a ban.
- 0e81564: The outcome taxonomy, `Outcome`, `FAILOVER` and `GatewayRequest` move from `@proxlane/adapters` to `@proxlane/shared`, so the base layer no longer depends on a leaf. `@proxlane/adapters` re-exports all of it, so adapter authors import exactly what they imported before.

### Patch Changes

- 1dc6bc8: ScraperAPI now reads the target's status from `sa-statuscode` instead of matching body prose, and reports the real credit cost from `sa-credit-cost` — a rendered request previously billed at 1 credit instead of 10. A target returning 403 is now `HARD_BLOCK` rather than `AUTH_FAILED`, which had marked the caller's own key unhealthy.
- Updated dependencies [48962c2]
- Updated dependencies [a8f8a3e]
- Updated dependencies [0f19f27]
- Updated dependencies [a611e21]
- Updated dependencies [6429c21]
- Updated dependencies [023530d]
- Updated dependencies [1dc6bc8]
- Updated dependencies [520ae48]
- Updated dependencies [6df863c]
- Updated dependencies [0e81564]
- Updated dependencies [8fb47d5]
  - @proxlane/shared@0.1.0
