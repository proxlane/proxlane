# proxlane

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
