# @proxlane/adapters

## 0.9.3

### Patch Changes

- [#260](https://github.com/proxlane/proxlane/pull/260) [`6af3e22`](https://github.com/proxlane/proxlane/commit/6af3e2247a359c5872c0e34c2263169e42117ac8) Thanks [@scarsam](https://github.com/scarsam)! - `pnpm conformance` now warns for a week before a deferred fixture comes due, instead of only failing on the day. The failure was well signposted once it fired — it names the category, the date, the command and the reason it was deferred — and completely silent until then, so a debt booked three weeks out arrives as a surprise red build on an ordinary morning. It now prints `DUE SOON` from seven days out, above the verdict rather than below it.

## 0.9.2

### Patch Changes

- [#252](https://github.com/proxlane/proxlane/pull/252) [`029dac8`](https://github.com/proxlane/proxlane/commit/029dac8350c41f7b1e4b1705555cf37a7956e36e) Thanks [@scarsam](https://github.com/scarsam)! - Three fixes found by reading the site on a phone and by running the contributor onboarding path end to end. The docs page list was a wrapping row that broke into four ragged lines on a 390px screen, landing at arbitrary positions against the fixed grid field painted behind every page, so it read as a broken table; it is now a disclosure that opens into the same left-rule list the on-page contents already used. Reference tables were told to fit the viewport, which compressed the widest column — always the last, always the prose — into a ribbon wrapping every cell to three lines; they now take their natural width and scroll, with the first column pinned so a row stays identifiable while you read across it. And `pnpm conformance` on a freshly scaffolded adapter crashed with a Node stack trace pointing into a build artefact, because a scaffold's `translate` throws by design and only `parse` was guarded — it now names the file to implement.

- [#253](https://github.com/proxlane/proxlane/pull/253) [`29150dc`](https://github.com/proxlane/proxlane/commit/29150dce4c7ca4203b4bf5c03804b39cd0c5f63d) Thanks [@scarsam](https://github.com/scarsam)! - All four cost tables re-read against the providers' own live documentation on 2026-08-31 and none had moved, so each `effectiveDate` advances and each carries a note of the figures the source states. ScraperAPI, ScrapingBee and Bright Data confirm every cell verbatim; Scrapfly's page shows the arithmetic the table encodes. Scrapfly's stealth column stays residential-equivalent because ASP "may dynamically upgrade the proxy pool" and therefore has no fixed published price, which is why cost from that provider arrives reported rather than estimated.

  Reading the pricing pages as well as the docs turned up a limit the matrix cannot express, and the comparison page now says so: two of the four price partly on what the _target_ does rather than on what you asked for. ScraperAPI adds ten credits per request when it bypasses Cloudflare, DataDome or PerimeterX, and Scrapfly's ASP may upgrade the proxy pool mid-request. Neither is a function of tier or rendering, which is the only thing a cost matrix is keyed on — which is the argument for preferring the reported figure over the estimated one, and for saying which you got.

## 0.9.1

### Patch Changes

- [#246](https://github.com/proxlane/proxlane/pull/246) [`8806f7a`](https://github.com/proxlane/proxlane/commit/8806f7a29180260006f1649ee4fe46be1ba07506) Thanks [@scarsam](https://github.com/scarsam)! - An exhausted Scrapfly plan is an account fact, not a provider outage. Scrapfly answers HTTP 429 with `ERR::SCRAPE::QUOTA_LIMIT_REACHED` and a null target status; unmapped, that fell through to `PROVIDER_ERROR`, which sits in the failure term of global provider health. One org running out of credits would therefore drive the health statistic down for every org and could demote Scrapfly out of every chain for hours — the same cross-org contamination already documented for `AUTH_FAILED`. It is now `RATE_LIMITED`, which cools per account and fails over to a provider that has credit.

## 0.9.0

### Minor Changes

- [#238](https://github.com/proxlane/proxlane/pull/238) [`9860659`](https://github.com/proxlane/proxlane/commit/9860659a32dbbc04e3c512911daf88e5786ac459) Thanks [@scarsam](https://github.com/scarsam)! - `wait_for=<css selector>` tells the renderer what to wait for before it snapshots the page. Rendering means the renderer ran, not that the content arrived — on a late-hydrating page the same request returns the full listing on one attempt and an empty shell on the next, and until now nothing in the request could name the finish line. It implies `render=true`, and it narrows the chain to providers that can express it: ScrapingBee's `wait_for` and Scrapfly's `wait_for_selector` were verified live, ScraperAPI's is its published name and the canary confirms it, and Bright Data declares it cannot — `x-unblock-expect` is accepted there and could not be shown to enforce a wait, so it is filtered out rather than charging for a page that did not wait.

### Patch Changes

- [#237](https://github.com/proxlane/proxlane/pull/237) [`afd2423`](https://github.com/proxlane/proxlane/commit/afd2423f0f31a9614ad728bc8cd83c21cc71b6a1) Thanks [@scarsam](https://github.com/scarsam)! - One executor for every request. The gateway, `proxlane scrape`, `pnpm record`, the k6 harness and the live canary now all call `createFetchTransport()` from `@proxlane/shared/transport`, instead of each hand-rolling its own `fetch`. The canary's copy dropped `wire.body`, which only Bright Data sends, so it reported a working key as `AUTH_FAILED` on every run — `repo:check` assertion 50 and a new contract test now hold the line. `proxlane scrape` and `pnpm record` gain the capped streaming read and the timeout/abort discrimination they were missing.

- Updated dependencies [[`afd2423`](https://github.com/proxlane/proxlane/commit/afd2423f0f31a9614ad728bc8cd83c21cc71b6a1), [`9860659`](https://github.com/proxlane/proxlane/commit/9860659a32dbbc04e3c512911daf88e5786ac459)]:
  - @proxlane/shared@0.11.0

## 0.8.0

### Minor Changes

- [#235](https://github.com/proxlane/proxlane/pull/235) [`b694712`](https://github.com/proxlane/proxlane/commit/b69471270c69894ccaa104214254e16e441cf97e) Thanks [@scarsam](https://github.com/scarsam)! - A Scrapfly response over 5MB no longer arrives as a URL marked `OK`. Scrapfly offloads bodies above that size to an object store and returns a pointer; `parse()` read it as the page, so the caller got 70 bytes with HTTP 200, the target's content-type and a charge. It is now `PROVIDER_BODY_OFFLOADED`, which fails over to a provider that returns the body inline.

### Patch Changes

- Updated dependencies [[`b694712`](https://github.com/proxlane/proxlane/commit/b69471270c69894ccaa104214254e16e441cf97e)]:
  - @proxlane/shared@0.10.0

## 0.7.5

### Patch Changes

- [#231](https://github.com/proxlane/proxlane/pull/231) [`1f955e8`](https://github.com/proxlane/proxlane/commit/1f955e823f348a2d4aca85780e3597641772868d) Thanks [@scarsam](https://github.com/scarsam)! - A fixture shape change now opens an issue instead of reddening a scheduled run nobody watches.
  The canary has reported that way since it was written; `record:diff` never did, and on 2026-08-26
  three of four adapters failed there and it went unnoticed for two days. One issue per adapter,
  with the shape diff in the body, and a comment rather than a duplicate on the next run.

  Bright Data gains the POST fixture it never had — the only adapter of four declaring `post: true`
  with no recorded evidence for it. Recorded against the live API; the target echoes the body back,
  so the fixture proves the body arrived rather than only that the request succeeded.

  Scrapfly's fixtures are re-recorded. Their request shape genuinely changed when `os` started
  being pinned, and the fixtures had not caught up. ScrapingBee's are re-recorded too, though its
  drift was the test target echoing a different set of request headers rather than anything
  ScrapingBee did.

## 0.7.4

### Patch Changes

- [#225](https://github.com/proxlane/proxlane/pull/225) [`a0d6487`](https://github.com/proxlane/proxlane/commit/a0d64874940e548b8f8f2e58c6903c6fc5caf5e4) Thanks [@scarsam](https://github.com/scarsam)! - The live canary's JavaScript-render check now scrapes a page this project serves, not a
  third-party scraping-demo site. That target failed twice in one morning on two different
  providers while answering in half a second from a laptop, and the launch gate counts three
  consecutive _scheduled_ greens with no way for a manual re-dispatch to repair a red one.

  The new marker is absent from the served HTML — the page assembles it from two halves at runtime
  — so a provider returning the unrendered document cannot satisfy the assertion by accident. The
  old marker was plain text in the source that the page also rendered, so it could.

  Verified live against all three providers before landing: OK with the marker present on each, at
  the exact cost the table predicts.

## 0.7.3

### Patch Changes

- [#217](https://github.com/proxlane/proxlane/pull/217) [`a9c624e`](https://github.com/proxlane/proxlane/commit/a9c624e1d20fa558636d0de593b7e5745d1a9580) Thanks [@scarsam](https://github.com/scarsam)! - The live canary retries once when the TARGET failed, and says so loudly.

  `operations.md` section 9 counts three consecutive _scheduled_ greens, and a manual re-dispatch
  does not repair a red one. So a third-party page having a bad minute on a Monday morning resets a
  three-week launch clock and nothing done afterwards fixes it. That happened twice in one morning
  on 2026-08-25, on two different providers, against a demo site answering in half a second from a
  laptop.

  `TARGET_ERROR` is the one outcome that says the failure was not the provider's, and this canary
  exists to ask whether the provider still behaves. Only that outcome is retried; everything the
  provider is blamed for is reported on the first attempt. The three tests expect `OK`,
  `TARGET_NOT_FOUND` and `OK`, so a retry cannot paper over an assertion.

- Updated dependencies [[`a43b34e`](https://github.com/proxlane/proxlane/commit/a43b34e76ded21c2a2f623e02a2b7cae5fcbe4a3)]:
  - @proxlane/shared@0.9.0

## 0.7.2

### Patch Changes

- [#199](https://github.com/proxlane/proxlane/pull/199) [`71a0421`](https://github.com/proxlane/proxlane/commit/71a042118619c7e1d4809fc1571bd4cb8b5c6022) Thanks [@scarsam](https://github.com/scarsam)! - Scrapfly now pins `os` instead of letting Scrapfly choose. ScraperAPI and ScrapingBee were both
  pinned to desktop, so the same request fetched a pinned desktop page on two providers and a
  provider-chosen one on the third — visible to the caller only as `X-Provider-Used` changing, on
  a gateway whose claim is that failover is invisible. It was always a leak; it got worse when
  their changelog added `android`, `iphone` and `ipad` to the values `os` picks among, so the
  unpinned set grew phones without anything changing on our side.

  The per-adapter test named "sets every parameter explicitly" passed throughout, because the list
  it iterates is hand-typed and therefore only covers the parameters somebody remembered. The
  check is now cross-adapter and asserts its own completeness against the registry, so a fifth
  adapter fails until somebody decides whether its API has a device parameter.

## 0.7.1

### Patch Changes

- Updated dependencies [[`3302c1c`](https://github.com/proxlane/proxlane/commit/3302c1c4ce77e02926a5f50404db44f1c00a0421)]:
  - @proxlane/shared@0.8.0

## 0.7.0

### Minor Changes

- [#175](https://github.com/proxlane/proxlane/pull/175) [`7d5c835`](https://github.com/proxlane/proxlane/commit/7d5c83592cfcc40281fdb9d465f020f922083282) Thanks [@scarsam](https://github.com/scarsam)! - Bright Data now returns the target's body for every outcome the taxonomy says carries one. A
  target 404 came back empty from Bright Data and full from the other three, so what a caller
  received depended on which provider won the chain. An error code arriving without a message
  header also fell through to OK — `reject_block` with no message was returned as a successful
  scrape of a challenge page.

  The conformance check that exists to catch exactly this only enforced the `OK` case.

- [#170](https://github.com/proxlane/proxlane/pull/170) [`84e83ce`](https://github.com/proxlane/proxlane/commit/84e83cecd0218db1ffce4c75c7e22d7a6f8e3df4) Thanks [@scarsam](https://github.com/scarsam)! - Capabilities can now describe a combination a provider refuses even though it offers each part
  alone. ScraperAPI's sessions and premium proxies are mutually exclusive by their own
  documentation, and the router used to send requests asking for both. Declared as data rather than
  a predicate, so `proxlane providers` prints it.

- [#168](https://github.com/proxlane/proxlane/pull/168) [`1248872`](https://github.com/proxlane/proxlane/commit/12488726f08b9e2dc0c047a56d56a4d926ac9625) Thanks [@scarsam](https://github.com/scarsam)! - ScraperAPI, ScrapingBee and Scrapfly now forward a POST body to the target. All four providers
  document POST support and only one adapter implemented it, so a POST request reached exactly one
  provider and could not fail over at all. Recorded `post` fixtures for all three, echoed back by
  the target to prove the body arrived.

- [#181](https://github.com/proxlane/proxlane/pull/181) [`bb6348d`](https://github.com/proxlane/proxlane/commit/bb6348d23895edbf5efd2a21419d852980679205) Thanks [@scarsam](https://github.com/scarsam)! - A provider's own `Retry-After` now reaches the caller. `ParsedResult.retryAfterMs` had been in the
  contract since it landed and the chain already armed cooldowns from it, but no adapter ever set
  it — so a provider that capped us and said exactly how long to wait had that answer discarded, the
  cooldown drew a 30s jittered guess, and the caller got a bare 429.

  Two chain fixes: an answered request whose next candidate lost its probe claim kept only the
  outcome name, dropping the provider, the body and the detect rule. And a throwing health store
  could make the chain re-attempt — and re-pay for — a provider it had already tried.

### Patch Changes

- [#179](https://github.com/proxlane/proxlane/pull/179) [`8c05ff9`](https://github.com/proxlane/proxlane/commit/8c05ff918d74b70b6bff758469daaad906a08b80) Thanks [@scarsam](https://github.com/scarsam)! - Scrapfly's stealth tier is priced at the residential figures, which is what it costs: `translate()`
  sends the residential proxy pool for every tier above `none`, so a stealth request is a residential
  request. It was published at the datacenter base — 1x against a real 25x on the comparison page.

  The router now reads the cost matrix as a capability claim. A null cell means the provider does not
  sell that combination, and ScrapingBee's stealth-without-rendering is one — it was being routed
  there and paid for.

- [#186](https://github.com/proxlane/proxlane/pull/186) [`4468690`](https://github.com/proxlane/proxlane/commit/4468690161f5e5c2b1f87d3839854d0f2849b07c) Thanks [@scarsam](https://github.com/scarsam)! - Every published package now has a description, keywords, a homepage and a README. Four of the five
  rendered "ERROR: No README data found!" on npmjs.com — including `@proxlane/adapters`, the
  Apache-2.0 package this project most wants strangers to contribute to.
- Updated dependencies [[`7e77a6d`](https://github.com/proxlane/proxlane/commit/7e77a6d09b470c77cdec25ff205d64f4bf930fb5), [`4468690`](https://github.com/proxlane/proxlane/commit/4468690161f5e5c2b1f87d3839854d0f2849b07c), [`292e67b`](https://github.com/proxlane/proxlane/commit/292e67b7fc1ec912a64910b88ae503e9b3180774), [`df7a4c0`](https://github.com/proxlane/proxlane/commit/df7a4c0ba816b444c970433ab0625147714ae81b)]:
  - @proxlane/shared@0.7.1

## 0.6.0

### Minor Changes

- [#152](https://github.com/proxlane/proxlane/pull/152) [`dc62320`](https://github.com/proxlane/proxlane/commit/dc623207db4dec332def4a37ef9e1097a80db9ec) Thanks [@scarsam](https://github.com/scarsam)! - `CostTable` stops being `base × multipliers` and becomes a matrix: one cost per proxy tier and
  render state, exhaustive, `null` where the provider does not sell that combination. No provider
  prices multiplicatively, so every adapter had been writing the closest product it could and
  leaving a note about it. Scrapfly is additive and was estimated 4.17× too high on residential
  plus rendering; ScrapingBee's premium tier is 25 credits with rendering, not 10. `proxlane
providers --json` now emits the matrix and, for the first time, the cost `unit` alongside it.

### Patch Changes

- [#153](https://github.com/proxlane/proxlane/pull/153) [`2a9142d`](https://github.com/proxlane/proxlane/commit/2a9142d9fb41baca8914fc6146966ea16d32584e) Thanks [@scarsam](https://github.com/scarsam)! - Cost tables must now carry a source URL and the date somebody last read it, no two providers may
  cite the same page, the scaffold's placeholder zeroes cannot ship, and a table nobody has re-read
  in a year fails the build. No test can verify a price without fetching a vendor's marketing site
  in CI, so this enforces the next best thing.

- [#151](https://github.com/proxlane/proxlane/pull/151) [`ea6e393`](https://github.com/proxlane/proxlane/commit/ea6e39310d697ff52697f760fd27a4dd1428965b) Thanks [@scarsam](https://github.com/scarsam)! - ScrapingBee's country list goes from 7 codes to the 42 it actually sells on classic proxies. The
  seven were an example table in their docs, and the router filters the failover chain on this set,
  so the provider was silently ineligible for thirty-five countries. `ru` leaves: it is premium-only,
  and classic silently serves `us` instead of erroring. Adds `CAPABILITIES`, a static export of every
  adapter's capabilities that does not load the adapters, and cross-provider assertions over it.

- [#155](https://github.com/proxlane/proxlane/pull/155) [`40897dc`](https://github.com/proxlane/proxlane/commit/40897dc56281f657e49fb4a471d05795ded3beba) Thanks [@scarsam](https://github.com/scarsam)! - `post` and `sessions` now say what they mean: a claim about the adapter, not about the provider.
  Both were undocumented booleans, and a research pass against the vendors' docs reported all four
  as live bugs because every provider sells POST and sessions — while every value was correct, since
  the field describes what `translate()` actually wires. Tests now hold each claim to the code that
  implements it.

- [#156](https://github.com/proxlane/proxlane/pull/156) [`6b89f31`](https://github.com/proxlane/proxlane/commit/6b89f312b442b53d231141356124217438f14e53) Thanks [@scarsam](https://github.com/scarsam)! - A scraping API comparison at `/scraping-api-comparison`: pick a request shape and see what each
  provider charges on top of its own base rate, from their published tables. Compares multipliers,
  which are dimensionless, and never compares base rates across billing units. Fixes Bright Data's
  base cost, which was a hundred times too low — the only provider whose cost we estimate rather
  than read off the response. `@proxlane/shared` gains an `./error-body` subpath so `@proxlane/adapters`
  no longer drags `node:crypto` into anything that imports it.
- Updated dependencies [[`d8f0661`](https://github.com/proxlane/proxlane/commit/d8f06614cc3c2279b06b222a85dc1f3524bfb048), [`6b89f31`](https://github.com/proxlane/proxlane/commit/6b89f312b442b53d231141356124217438f14e53)]:
  - @proxlane/shared@0.7.0

## 0.5.1

### Patch Changes

- Updated dependencies [[`89f92ba`](https://github.com/proxlane/proxlane/commit/89f92ba1af670329d9eca3c15394f04a8803b6ee)]:
  - @proxlane/shared@0.6.0

## 0.5.0

### Minor Changes

- [#125](https://github.com/proxlane/proxlane/pull/125) [`fc0b684`](https://github.com/proxlane/proxlane/commit/fc0b684a60341478b09c45a6e2cf675109928497) Thanks [@scarsam](https://github.com/scarsam)! - Returning a body byte for byte is now a declared capability, and `binary=true` a request
  parameter. An image request used to return 200 with a corrupted body; it now routes only to
  providers that can carry bytes, or answers `NO_PROVIDER_AVAILABLE`. Three of the four launch
  providers carry binary. ScraperAPI does not — it decodes bodies as UTF-8, and its own API says
  so: `binary_target=true` answers 400, "The file type you are trying to scrape is not supported."

- [#127](https://github.com/proxlane/proxlane/pull/127) [`ae360a9`](https://github.com/proxlane/proxlane/commit/ae360a9b3f0ebe618c93abc4b47d301a2601f4ff) Thanks [@scarsam](https://github.com/scarsam)! - The Bright Data adapter asks for `format: 'raw'` and can now return bytes. It used `json` because
  "raw returns an API 200 whatever the target did" — true of the API's status line, but
  `x-brd-status-code` carries the target's status on every raw response, so raw is a strict superset:
  same outcomes, plus the original bytes and the target's real charset. Three of four adapters now
  carry binary; ScraperAPI cannot, and says so.

- [#123](https://github.com/proxlane/proxlane/pull/123) [`ae17465`](https://github.com/proxlane/proxlane/commit/ae174650f2803c0f4cb035035306d2b6f12f0649) Thanks [@scarsam](https://github.com/scarsam)! - A cost number now carries its unit, and units are never summed together. Three launch providers
  sell credits and Bright Data bills cents, so `X-Cost-Estimate` was adding one provider credit to
  fifteen hundredths of a cent and reporting the result as a quantity. `CostTable.unit` is required,
  the gateway emits `X-Cost-Unit` beside the figure, and a chain that spent in two units reports
  `mixed` rather than an invented total.

- [#126](https://github.com/proxlane/proxlane/pull/126) [`0a63439`](https://github.com/proxlane/proxlane/commit/0a63439da4c60c8a43bc42ebedc68f709104ca94) Thanks [@scarsam](https://github.com/scarsam)! - Scrapfly is declared binary-capable, which it always was — it reports `result.format: 'binary'`
  and base64-encodes the content, and the adapter already decoded that. The earlier `false` came
  from measuring the provider's wire response instead of the adapter's output. Conformance now
  asserts the `binary` flag against a recorded JPEG through `parse`, in both directions, and the
  fixture is required of every adapter.

### Patch Changes

- [#128](https://github.com/proxlane/proxlane/pull/128) [`8e146cd`](https://github.com/proxlane/proxlane/commit/8e146cd6e0a454c00c99e69e70547d642a34778f) Thanks [@scarsam](https://github.com/scarsam)! - The conformance binary check no longer passes a corrupt file whose magic bytes happen to be
  printable. WebP is "RIFF", PDF is "%PDF", ZIP and XLSX are "PK", GIF is "GIF8" — all survive a
  UTF-8 round trip intact while the rest of the file is destroyed, so a magic-only check went quiet
  on every one of them. It now also counts U+FFFD replacement characters, whose presence in a
  binary body is the corruption itself, whatever the format.
- Updated dependencies [[`fc0b684`](https://github.com/proxlane/proxlane/commit/fc0b684a60341478b09c45a6e2cf675109928497)]:
  - @proxlane/shared@0.5.0

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
