# proxlane

## 0.4.10

### Patch Changes

- Updated dependencies [[`029dac8`](https://github.com/proxlane/proxlane/commit/029dac8350c41f7b1e4b1705555cf37a7956e36e), [`29150dc`](https://github.com/proxlane/proxlane/commit/29150dce4c7ca4203b4bf5c03804b39cd0c5f63d)]:
  - @proxlane/adapters@0.9.2

## 0.4.9

### Patch Changes

- Updated dependencies [[`8806f7a`](https://github.com/proxlane/proxlane/commit/8806f7a29180260006f1649ee4fe46be1ba07506)]:
  - @proxlane/adapters@0.9.1

## 0.4.8

### Patch Changes

- [#237](https://github.com/proxlane/proxlane/pull/237) [`afd2423`](https://github.com/proxlane/proxlane/commit/afd2423f0f31a9614ad728bc8cd83c21cc71b6a1) Thanks [@scarsam](https://github.com/scarsam)! - One executor for every request. The gateway, `proxlane scrape`, `pnpm record`, the k6 harness and the live canary now all call `createFetchTransport()` from `@proxlane/shared/transport`, instead of each hand-rolling its own `fetch`. The canary's copy dropped `wire.body`, which only Bright Data sends, so it reported a working key as `AUTH_FAILED` on every run — `repo:check` assertion 50 and a new contract test now hold the line. `proxlane scrape` and `pnpm record` gain the capped streaming read and the timeout/abort discrimination they were missing.

- Updated dependencies [[`afd2423`](https://github.com/proxlane/proxlane/commit/afd2423f0f31a9614ad728bc8cd83c21cc71b6a1), [`9860659`](https://github.com/proxlane/proxlane/commit/9860659a32dbbc04e3c512911daf88e5786ac459)]:
  - @proxlane/shared@0.11.0
  - @proxlane/adapters@0.9.0

## 0.4.7

### Patch Changes

- Updated dependencies [[`b694712`](https://github.com/proxlane/proxlane/commit/b69471270c69894ccaa104214254e16e441cf97e)]:
  - @proxlane/shared@0.10.0
  - @proxlane/adapters@0.8.0

## 0.4.6

### Patch Changes

- Updated dependencies [[`1f955e8`](https://github.com/proxlane/proxlane/commit/1f955e823f348a2d4aca85780e3597641772868d)]:
  - @proxlane/adapters@0.7.5

## 0.4.5

### Patch Changes

- Updated dependencies [[`a0d6487`](https://github.com/proxlane/proxlane/commit/a0d64874940e548b8f8f2e58c6903c6fc5caf5e4)]:
  - @proxlane/adapters@0.7.4

## 0.4.4

### Patch Changes

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

- Updated dependencies [[`a9c624e`](https://github.com/proxlane/proxlane/commit/a9c624e1d20fa558636d0de593b7e5745d1a9580), [`a43b34e`](https://github.com/proxlane/proxlane/commit/a43b34e76ded21c2a2f623e02a2b7cae5fcbe4a3)]:
  - @proxlane/adapters@0.7.3
  - @proxlane/shared@0.9.0

## 0.4.3

### Patch Changes

- [#201](https://github.com/proxlane/proxlane/pull/201) [`b6995dd`](https://github.com/proxlane/proxlane/commit/b6995dd7ca28978c9b98e52cd172dd423a0b427e) Thanks [@scarsam](https://github.com/scarsam)! - The Quickstart now starts a gateway before telling you to call one. "Get started" is the site's
  primary call to action and it lands here; the page opened by asking the reader to curl
  `https://your-gateway/…`, a placeholder that resolves to nothing, and only explained how to have
  a gateway eighty lines further down. It never mentioned `localhost` at all, so the address you
  would actually call appeared nowhere on the page. Order is now: start it, call it, migrate, move
  the key out of the query string.

  `proxlane doctor` fails when no provider key is set. Each per-key check stays green when absent,
  because BYOK means you bring the providers you use and flagging the three you do not have trains
  people to skip the output. Applied to _every_ key, that produced "13 checks, all good" for a
  gateway that cannot route one request. Zero keys is a different condition from one missing key,
  and now it has its own check with a fix line.

- Updated dependencies [[`71a0421`](https://github.com/proxlane/proxlane/commit/71a042118619c7e1d4809fc1571bd4cb8b5c6022)]:
  - @proxlane/adapters@0.7.2

## 0.4.2

### Patch Changes

- Updated dependencies [[`3302c1c`](https://github.com/proxlane/proxlane/commit/3302c1c4ce77e02926a5f50404db44f1c00a0421)]:
  - @proxlane/shared@0.8.0
  - @proxlane/adapters@0.7.1

## 0.4.1

### Patch Changes

- [#170](https://github.com/proxlane/proxlane/pull/170) [`84e83ce`](https://github.com/proxlane/proxlane/commit/84e83cecd0218db1ffce4c75c7e22d7a6f8e3df4) Thanks [@scarsam](https://github.com/scarsam)! - Capabilities can now describe a combination a provider refuses even though it offers each part
  alone. ScraperAPI's sessions and premium proxies are mutually exclusive by their own
  documentation, and the router used to send requests asking for both. Declared as data rather than
  a predicate, so `proxlane providers` prints it.

- [#186](https://github.com/proxlane/proxlane/pull/186) [`4468690`](https://github.com/proxlane/proxlane/commit/4468690161f5e5c2b1f87d3839854d0f2849b07c) Thanks [@scarsam](https://github.com/scarsam)! - Every published package now has a description, keywords, a homepage and a README. Four of the five
  rendered "ERROR: No README data found!" on npmjs.com — including `@proxlane/adapters`, the
  Apache-2.0 package this project most wants strangers to contribute to.
- Updated dependencies [[`7d5c835`](https://github.com/proxlane/proxlane/commit/7d5c83592cfcc40281fdb9d465f020f922083282), [`7e77a6d`](https://github.com/proxlane/proxlane/commit/7e77a6d09b470c77cdec25ff205d64f4bf930fb5), [`84e83ce`](https://github.com/proxlane/proxlane/commit/84e83cecd0218db1ffce4c75c7e22d7a6f8e3df4), [`8c05ff9`](https://github.com/proxlane/proxlane/commit/8c05ff918d74b70b6bff758469daaad906a08b80), [`4468690`](https://github.com/proxlane/proxlane/commit/4468690161f5e5c2b1f87d3839854d0f2849b07c), [`1248872`](https://github.com/proxlane/proxlane/commit/12488726f08b9e2dc0c047a56d56a4d926ac9625), [`292e67b`](https://github.com/proxlane/proxlane/commit/292e67b7fc1ec912a64910b88ae503e9b3180774), [`bb6348d`](https://github.com/proxlane/proxlane/commit/bb6348d23895edbf5efd2a21419d852980679205), [`df7a4c0`](https://github.com/proxlane/proxlane/commit/df7a4c0ba816b444c970433ab0625147714ae81b)]:
  - @proxlane/adapters@0.7.0
  - @proxlane/shared@0.7.1

## 0.4.0

### Minor Changes

- [#152](https://github.com/proxlane/proxlane/pull/152) [`dc62320`](https://github.com/proxlane/proxlane/commit/dc623207db4dec332def4a37ef9e1097a80db9ec) Thanks [@scarsam](https://github.com/scarsam)! - `CostTable` stops being `base × multipliers` and becomes a matrix: one cost per proxy tier and
  render state, exhaustive, `null` where the provider does not sell that combination. No provider
  prices multiplicatively, so every adapter had been writing the closest product it could and
  leaving a note about it. Scrapfly is additive and was estimated 4.17× too high on residential
  plus rendering; ScrapingBee's premium tier is 25 credits with rendering, not 10. `proxlane
providers --json` now emits the matrix and, for the first time, the cost `unit` alongside it.

### Patch Changes

- Updated dependencies [[`dc62320`](https://github.com/proxlane/proxlane/commit/dc623207db4dec332def4a37ef9e1097a80db9ec), [`2a9142d`](https://github.com/proxlane/proxlane/commit/2a9142d9fb41baca8914fc6146966ea16d32584e), [`ea6e393`](https://github.com/proxlane/proxlane/commit/ea6e39310d697ff52697f760fd27a4dd1428965b), [`d8f0661`](https://github.com/proxlane/proxlane/commit/d8f06614cc3c2279b06b222a85dc1f3524bfb048), [`40897dc`](https://github.com/proxlane/proxlane/commit/40897dc56281f657e49fb4a471d05795ded3beba), [`6b89f31`](https://github.com/proxlane/proxlane/commit/6b89f312b442b53d231141356124217438f14e53)]:
  - @proxlane/adapters@0.6.0
  - @proxlane/shared@0.7.0

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
