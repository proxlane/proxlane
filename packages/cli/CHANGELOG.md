# proxlane

## 0.3.3

### Patch Changes

- Updated dependencies [[`89f92ba`](https://github.com/proxlane/proxlane/commit/89f92ba1af670329d9eca3c15394f04a8803b6ee)]:
  - @proxlane/shared@0.6.0
  - @proxlane/adapters@0.5.1

## 0.3.2

### Patch Changes

- Updated dependencies [[`8e146cd`](https://github.com/proxlane/proxlane/commit/8e146cd6e0a454c00c99e69e70547d642a34778f), [`fc0b684`](https://github.com/proxlane/proxlane/commit/fc0b684a60341478b09c45a6e2cf675109928497), [`ae360a9`](https://github.com/proxlane/proxlane/commit/ae360a9b3f0ebe618c93abc4b47d301a2601f4ff), [`ae17465`](https://github.com/proxlane/proxlane/commit/ae174650f2803c0f4cb035035306d2b6f12f0649), [`0a63439`](https://github.com/proxlane/proxlane/commit/0a63439da4c60c8a43bc42ebedc68f709104ca94)]:
  - @proxlane/adapters@0.5.0
  - @proxlane/shared@0.5.0

## 0.3.1

### Patch Changes

- [#120](https://github.com/proxlane/proxlane/pull/120) [`b6e7891`](https://github.com/proxlane/proxlane/commit/b6e7891f7e120b17b589beab7e92e64583d247b7) Thanks [@scarsam](https://github.com/scarsam)! - One NDJSON line per `/v1` request, to stdout. The gateway logged nothing at all, so the moment it
  was reachable by anyone there was no way to answer who probed it, which domains were scraped,
  which provider served them, or what the outcome mix looked like. Records the target's host rather
  than the URL, because query strings carry credentials. `PROXLANE_LOG=off` to silence it; `proxlane
doctor` reports which.

## 0.3.0

### Minor Changes

- [#111](https://github.com/proxlane/proxlane/pull/111) [`258e5fc`](https://github.com/proxlane/proxlane/commit/258e5fc227c795fa6fad07fd57734bfe3f05e5f2) Thanks [@scarsam](https://github.com/scarsam)! - `proxlane outcomes` now says what to do about an outcome, not only what it means: an `action`, a
  sentence of why, and a link to the class's docs section. The policy fields describe what the
  gateway does internally — `failover: true` on a blocked outcome means every provider was already
  tried — which is the opposite of what a caller reading it as "retryable" would conclude.

  Error responses and the CLI both link to `proxlane.dev/docs/outcomes`, which is live. They
  pointed at GitHub because `docs.proxlane.dev` has no DNS record; it was the subdomain that never
  existed, not the docs.

- [#105](https://github.com/proxlane/proxlane/pull/105) [`1e3ea1f`](https://github.com/proxlane/proxlane/commit/1e3ea1f426d5b055da823eb080b61c88cc59fd6b) Thanks [@scarsam](https://github.com/scarsam)! - Retry the last provider in the chain once before giving up, on `PROVIDER_ERROR` and
  `PROVIDER_TIMEOUT` only. Set `PROXLANE_TERMINAL_RETRIES` to change it, 0 to switch it off.
  Everywhere else in the chain, failover is still the retry.

### Patch Changes

- Updated dependencies [[`e7dc4a4`](https://github.com/proxlane/proxlane/commit/e7dc4a4cd1d3418bd7f43205099f1abdfb142c75), [`d3ff8c2`](https://github.com/proxlane/proxlane/commit/d3ff8c279b3d3725664559dbe882237dc2006ac5), [`4db45e1`](https://github.com/proxlane/proxlane/commit/4db45e18b32cda1851749b33ec605fd15f800cfe), [`258e5fc`](https://github.com/proxlane/proxlane/commit/258e5fc227c795fa6fad07fd57734bfe3f05e5f2)]:
  - @proxlane/adapters@0.4.0
  - @proxlane/shared@0.4.0

## 0.2.0

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

### Patch Changes

- 650a4bc: A mark, honest SEO, and no em dashes in shipped copy.

  The wordmark sets the interchange station as the `o` in proxlane, and the standalone mark is
  three provider lines with a station on the middle one, which is the version that survives 16px
  in a browser tab. No second typeface: design.md chooses one sans and says the diagram is the
  display element.

  Adds canonical, Open Graph and Twitter tags, our own robots.txt, and a sitemap, and points the
  Worker at proxlane.dev. Without a robots.txt Cloudflare served its own, which was 25 lines of
  AI content-signal terms nobody here wrote.

  Removes em dashes from user-facing copy. Five of the six were real `proxlane doctor` output and
  the exit-code table, so they are fixed at source rather than edited on the page, which would
  have made a transcript into a mock-up.

- Updated dependencies [abf833f]
- Updated dependencies [c48afba]
- Updated dependencies [4ed05a5]
  - @proxlane/shared@0.3.0
  - @proxlane/adapters@0.3.1

## 0.1.2

### Patch Changes

- Updated dependencies [d299128]
  - @proxlane/adapters@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [9e705a6]
- Updated dependencies [baa3c0f]
  - @proxlane/adapters@0.2.0

## 0.1.0

### Minor Changes

- 222a896: `proxlane doctor` now diagnoses routing state: where it lives, whether an empty `PROXLANE_VALKEY_URL` is being read as unset, whether the replica count matches the state backing, which of health and cooldowns are on, and whether a configured Valkey is actually reachable.

### Patch Changes

- 1dc6bc8: `proxlane --version` now reports the package's real version. It was hardcoded to `0.0.0` and printed that from a package published as `0.0.1`.
- 6df863c: A target 429 is now `TARGET_RATE_LIMITED` rather than `TARGET_ERROR`: it returns 429 to the caller, fails over to a different egress, and arms the shared domain cooldown. Previously it armed nothing, so the next request retried immediately — which is what escalates a rate limit into a ban.
- Updated dependencies [a611e21]
- Updated dependencies [023530d]
- Updated dependencies [1dc6bc8]
- Updated dependencies [6df863c]
- Updated dependencies [0e81564]
  - @proxlane/adapters@0.1.0
