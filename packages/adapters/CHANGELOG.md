# @proxlane/adapters

## 0.4.0

### Minor Changes

- [#104](https://github.com/proxlane/proxlane/pull/104) [`e7dc4a4`](https://github.com/proxlane/proxlane/commit/e7dc4a4cd1d3418bd7f43205099f1abdfb142c75) Thanks [@scarsam](https://github.com/scarsam)! - Add a Bright Data Web Unlocker adapter, the fourth provider and the first for a service this
  project does not itself pay for. It reads the target's real status out of the JSON envelope
  rather than the raw body, and decodes Bright Data's own `x-brd-error-code` so a dead target is
  not blamed on the provider.

  Two pieces of shared tooling assumed a provider's parameters live in the URL, which was true
  of the first three by coincidence. The conformance suite and the replay transport now read the
  request body too, and the recorded-target matrix moved off a Cloudflare-fronted host that an
  unblocking provider correctly refuses to pass through.

- [#106](https://github.com/proxlane/proxlane/pull/106) [`d3ff8c2`](https://github.com/proxlane/proxlane/commit/d3ff8c279b3d3725664559dbe882237dc2006ac5) Thanks [@scarsam](https://github.com/scarsam)! - A host that does not resolve is now `TARGET_ERROR` from every provider. Scrapfly reported it
  as `INVALID_REQUEST`, which paged a human and stopped the chain; Bright Data as
  `PROVIDER_ERROR`, which cooled a healthy provider. Conformance now asserts the recorded
  outcome for the new `dead-host` fixture, which is what makes it stay fixed.

- [#108](https://github.com/proxlane/proxlane/pull/108) [`4db45e1`](https://github.com/proxlane/proxlane/commit/4db45e18b32cda1851749b33ec605fd15f800cfe) Thanks [@scarsam](https://github.com/scarsam)! - Bright Data gets its own line colour. It shared slot 1 with ScraperAPI, because `line` was
  typed `1 | 2 | 3` and taking an existing slot was the only way to compile — so the two were
  drawn in the same colour and a failover between them was invisible. `pnpm tokens:check` now
  fails on a shared slot or a slot with no token behind it.

- [#111](https://github.com/proxlane/proxlane/pull/111) [`258e5fc`](https://github.com/proxlane/proxlane/commit/258e5fc227c795fa6fad07fd57734bfe3f05e5f2) Thanks [@scarsam](https://github.com/scarsam)! - `proxlane outcomes` now says what to do about an outcome, not only what it means: an `action`, a
  sentence of why, and a link to the class's docs section. The policy fields describe what the
  gateway does internally — `failover: true` on a blocked outcome means every provider was already
  tried — which is the opposite of what a caller reading it as "retryable" would conclude.

  Error responses and the CLI both link to `proxlane.dev/docs/outcomes`, which is live. They
  pointed at GitHub because `docs.proxlane.dev` has no DNS record; it was the subdomain that never
  existed, not the docs.

### Patch Changes

- Updated dependencies [[`258e5fc`](https://github.com/proxlane/proxlane/commit/258e5fc227c795fa6fad07fd57734bfe3f05e5f2)]:
  - @proxlane/shared@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [abf833f]
- Updated dependencies [c48afba]
- Updated dependencies [4ed05a5]
  - @proxlane/shared@0.3.0

## 0.3.0

### Minor Changes

- d299128: The route diagram: one request's journey drawn from attempt data, with provider line colours assigned in the adapter registry so every surface picks them up from one place.

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
