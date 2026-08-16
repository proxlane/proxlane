# @proxlane/gateway

## 0.3.2

### Patch Changes

- fcca935: Fix the image publish. The per-architecture digest was written to a filename containing a
  colon, which `upload-artifact` rejects, so both builds succeeded and then failed at the upload
  step. Native arm64 itself works: it produced a digest in under a minute, against the hour the
  emulated build ran without finishing.
- 8a79315: Publish the image on a gateway release. The image job was gated on npm having published
  something, but the gateway is `private: true` and never publishes, so every gateway-only
  release skipped it and ghcr fell two minor versions behind. The image is also now tagged with
  the gateway's own version rather than the CLI's.

## 0.3.1

### Patch Changes

- 2ff2260: Publish the container image for arm64 on a native arm64 runner instead of emulating it. The
  previous multi-arch build ran under QEMU and did not finish, which left the published image
  two minor versions behind npm. Self-hosters on Pi and Ampere are the reason arm64 ships at
  all, so the image being stale mattered most to exactly them.

## 0.3.0

### Minor Changes

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

- cd6dabb: Emit `Server-Timing: gw;dur=…, up;dur=…, total;dur=…` on every `/v1` response. `gw` is
  gateway-internal time — the number `operations.md` section 1 gates p95 on, and the one a user
  needs when asking whether the gateway or the provider was slow. Split by subtraction, so a
  segment nobody instrumented lands in `gw` where it is visible rather than going unmeasured.

  Each attempt now records `upstreamMs`, which is wall time inside the provider call and unlike
  `latencyMs` is set even when the hop times out.

### Patch Changes

- ce5f243: Fix `pnpm dev` for the gateway. It ran `node --watch src/index.ts`, which could never work:
  application source imports siblings as `./app.js`, and Node's type stripping does not rewrite
  that to `.ts`, so the process died on its first import. It builds and runs the output now.
  `repo:check` assertion 27 fails on any script that runs bare node against `src/**` TypeScript.
- 94d6a7a: Build the load harness `operations.md` section 9 asks for: a local mock provider that returns
  slow responses, 429s, huge bodies and challenge pages on demand, the real gateway wired to it
  over a real socket, and a k6 soak that gates on p95 of `Server-Timing: gw;dur=`, RSS slope
  from minute 10, and the concurrency ceiling actually shedding. `pnpm k6:soak` is implemented;
  22 of 25 commands are now real.

  The gateway gains `./app` and `./transport` export paths so the harness can build the real app
  from the shipped artifact rather than importing source.

- d155542: Cover the two things nothing tested. The real HTTP transport now has an e2e against a
  deliberately hostile server, including a regression test for the measured bug where a body
  trickling in after the headers ran six times its budget. And `build-docker` now boots the
  image it builds, asserting the gateway refuses to start without a key, serves `/health`,
  answers `/v1` with the taxonomy, and prints its banner. `selfhost:smoke` runs weekly.
- Updated dependencies [abf833f]
- Updated dependencies [c48afba]
- Updated dependencies [4ed05a5]
  - @proxlane/shared@0.3.0
  - @proxlane/adapters@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies [d299128]
  - @proxlane/adapters@0.3.0

## 0.2.0

### Minor Changes

- 7f6597e: Accept the gateway key as `Authorization: Bearer <key>` alongside `?api_key=`, and route POST on `/v1` with the request body capped by `maxBodyBytes`. The query parameter stays: it is the drop-in migration surface.
- 9e705a6: **Breaking:** every non-2xx now returns one envelope — `{requestId, error: {code, class, message, docs}, attempts?}` — instead of `{error, message}` for auth and validation and `{outcome, class, attempts}` for a failed scrape. Response headers are unchanged.
- baa3c0f: Add `OutcomeClass`, a closed six-member classification alongside the open `Outcome` union, and send it as `X-Outcome-Class` and in the JSON error body. Branch on the class: it does not grow, so adding an outcome no longer breaks callers.
- 9c93bb5: Every response now carries `X-Request-Id` and a matching `requestId` in the JSON body, including 401s and validation errors. A caller's own `X-Request-Id` is echoed when it is safe to. Adds `uuidv7`, monotonic and clock-regression-safe, which will also be `requests.id`.

### Patch Changes

- Updated dependencies [9e705a6]
- Updated dependencies [baa3c0f]
- Updated dependencies [9c93bb5]
  - @proxlane/shared@0.2.0
  - @proxlane/adapters@0.2.0

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
