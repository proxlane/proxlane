# @proxlane/gateway

## 0.1.0

### Minor Changes

- a8f8a3e: Cooldowns are implemented: two namespaces (`cd:blk` by domain, `cd:acct` by org), exponential backoff with full jitter and a 15-minute cap, and half-open expiry where the single post-expiry probe must be claimed atomically. The gateway skips cooled providers before dividing the deadline, and returns `Retry-After` when every capable provider is cooling.
- 48d9909: The provider order is now an explicit, operator-overridable list (`PROXLANE_PROVIDER_ORDER`) rather than `Object.keys(REGISTRY).sort()` — which was alphabetical, chosen by nobody, and decided which provider got paid first on every request.
- 0f19f27: Health tracking now defaults to off: its calibration assumes independent failures, and a two-regime provider with the same mean failure rate spends over 90% of its time demoted in simulation. Set `PROXLANE_HEALTH=on` to enable it. Every published figure has been regenerated from the simulation, and `repo:check` assertion 21 now fails when the prose drifts from the measurement.
- a887a0e: The gateway now routes on provider health: the chain is re-ranked by state, demoted providers are dropped, the least-bad one is forced rather than refusing, and the result is reported on `X-Provider-Health` and `GET /health/providers`.
- 023530d: A cooldown now waits as long as the target's own `Retry-After` asks, when the provider exposes it — measured: ScrapingBee forwards it as `spb-retry-after`, Scrapfly exposes it in the envelope, ScraperAPI strips it. Clamped to the 15-minute cap, with the jittered backoff as the fallback.
- 1a9d11f: The background prober lifts demoted providers back into rotation: paced by the documented backoff, leased when several replicas share a Valkey, and pointed at the same stable target the canary uses. `GET /health/cooldowns` shows the cooldowns actually held, split by namespace, so an operator can see why a provider is being skipped.
- 6df863c: A target 429 is now `TARGET_RATE_LIMITED` rather than `TARGET_ERROR`: it returns 429 to the caller, fails over to a different egress, and arms the shared domain cooldown. Previously it armed nothing, so the next request retried immediately — which is what escalates a rate limit into a ban.

### Patch Changes

- adda6f2: Six routing defects found by an independent review panel: a claimed cooldown probe was never released unless the outcome armed or was exactly `OK`, a concurrent success deleted the account cooldown another request had just armed, the demoted floor was computed before cooldowns and so could be routed past, the terminal hop's larger timeout went to the least healthy provider, an exhausted chain reported the previous provider's failure, and `Retry-After` could be `0`.
- 48962c2: Corrects every published health figure that disagreed between files, removes three false citations from `health.ts` (including one reintroducing the exact defect that file documents), pins the five constants a mutation sweep found unpinned, and strengthens `repo:check` assertion 21 against the bypasses a verification panel demonstrated.
- 3c0e037: The probe settlement fix was incomplete: it marked a claim settled whenever any cooldown key was written, so eight of sixteen outcomes stranded a probe when the claimed and written keys were in different namespaces — including a successful probe on an account cooldown, which took a working provider out of service. A lost probe claim now also re-ranks the chain, so the demoted floor can still see a usable fallback.
- 520ae48: Security follow-ups: hostnames in cooldown keys are bounded to 253 characters, a trailing FQDN dot no longer creates a second key for the same site, the gateway key comparison uses `timingSafeEqual` rather than a length-short-circuiting loop, and `PROXLANE_ORG_ID` actually reaches the chain so `cd:acct` is namespaced per deployment.
- 5c5bfe8: Fix the default self-host deployment, which built a Redis client for an empty `PROXLANE_VALKEY_URL` and returned 500 from `/health/providers`. Compose now passes every variable the gateway reads, empty is treated as unset, and `/health/providers` fails open like the routing path.
- 80ed71f: A gateway shutting down while Valkey is unreachable no longer crashes: `redis.quit()` rejects on a broken socket, and each shutdown step is now independent.
- 92d181a: Valkey store robustness: the observation buffer is bounded and no longer amplifies load against a struggling store, in-flight batches stay visible to reads, a throwing error reporter can no longer kill the process, the claim script fails open on an unreadable record like the JS side does, and the gateway drains on SIGTERM instead of dropping buffered work.
- Updated dependencies [48962c2]
- Updated dependencies [a8f8a3e]
- Updated dependencies [25ba49b]
- Updated dependencies [b1f13d2]
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
  - @proxlane/detect@0.1.0
  - @proxlane/adapters@0.1.0
