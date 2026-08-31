# @proxlane/gateway

## 0.14.2

### Patch Changes

- Updated dependencies [[`029dac8`](https://github.com/proxlane/proxlane/commit/029dac8350c41f7b1e4b1705555cf37a7956e36e), [`29150dc`](https://github.com/proxlane/proxlane/commit/29150dce4c7ca4203b4bf5c03804b39cd0c5f63d)]:
  - @proxlane/adapters@0.9.2

## 0.14.1

### Patch Changes

- Updated dependencies [[`c798431`](https://github.com/proxlane/proxlane/commit/c7984315e320c203d99fce7dd4872203caa26d61), [`8caef80`](https://github.com/proxlane/proxlane/commit/8caef808d5e259b69000baaf27e5dbca6f3a20d1)]:
  - @proxlane/detect@0.3.1

## 0.14.0

### Minor Changes

- [#243](https://github.com/proxlane/proxlane/pull/243) [`0c8d9b4`](https://github.com/proxlane/proxlane/commit/0c8d9b47eecb6a0f022f0852e25c9df064fc9861) Thanks [@scarsam](https://github.com/scarsam)! - A hard block now says who blocked you. `HARD_BLOCK` is the provider reporting a block — for three of the four adapters that is literally `status === 403` — and the detector never ran on it, so the response carried `X-Outcome: HARD_BLOCK` with no `X-Detect-Rule` beside it. On the product whose pitch is naming the defence, the one outcome that _is_ a block could not name it. The outcome is deliberately unchanged; this only adds the label, and a page no rule recognises gets no label rather than a guess.

### Patch Changes

- Updated dependencies [[`8806f7a`](https://github.com/proxlane/proxlane/commit/8806f7a29180260006f1649ee4fe46be1ba07506)]:
  - @proxlane/adapters@0.9.1

## 0.13.0

### Minor Changes

- [#238](https://github.com/proxlane/proxlane/pull/238) [`9860659`](https://github.com/proxlane/proxlane/commit/9860659a32dbbc04e3c512911daf88e5786ac459) Thanks [@scarsam](https://github.com/scarsam)! - `wait_for=<css selector>` tells the renderer what to wait for before it snapshots the page. Rendering means the renderer ran, not that the content arrived — on a late-hydrating page the same request returns the full listing on one attempt and an empty shell on the next, and until now nothing in the request could name the finish line. It implies `render=true`, and it narrows the chain to providers that can express it: ScrapingBee's `wait_for` and Scrapfly's `wait_for_selector` were verified live, ScraperAPI's is its published name and the canary confirms it, and Bright Data declares it cannot — `x-unblock-expect` is accepted there and could not be shown to enforce a wait, so it is filtered out rather than charging for a page that did not wait.

### Patch Changes

- [#237](https://github.com/proxlane/proxlane/pull/237) [`afd2423`](https://github.com/proxlane/proxlane/commit/afd2423f0f31a9614ad728bc8cd83c21cc71b6a1) Thanks [@scarsam](https://github.com/scarsam)! - One executor for every request. The gateway, `proxlane scrape`, `pnpm record`, the k6 harness and the live canary now all call `createFetchTransport()` from `@proxlane/shared/transport`, instead of each hand-rolling its own `fetch`. The canary's copy dropped `wire.body`, which only Bright Data sends, so it reported a working key as `AUTH_FAILED` on every run — `repo:check` assertion 50 and a new contract test now hold the line. `proxlane scrape` and `pnpm record` gain the capped streaming read and the timeout/abort discrimination they were missing.

- Updated dependencies [[`afd2423`](https://github.com/proxlane/proxlane/commit/afd2423f0f31a9614ad728bc8cd83c21cc71b6a1), [`9860659`](https://github.com/proxlane/proxlane/commit/9860659a32dbbc04e3c512911daf88e5786ac459)]:
  - @proxlane/shared@0.11.0
  - @proxlane/adapters@0.9.0

## 0.12.0

### Minor Changes

- [#235](https://github.com/proxlane/proxlane/pull/235) [`b694712`](https://github.com/proxlane/proxlane/commit/b69471270c69894ccaa104214254e16e441cf97e) Thanks [@scarsam](https://github.com/scarsam)! - A Scrapfly response over 5MB no longer arrives as a URL marked `OK`. Scrapfly offloads bodies above that size to an object store and returns a pointer; `parse()` read it as the page, so the caller got 70 bytes with HTTP 200, the target's content-type and a charge. It is now `PROVIDER_BODY_OFFLOADED`, which fails over to a provider that returns the body inline.

### Patch Changes

- Updated dependencies [[`b694712`](https://github.com/proxlane/proxlane/commit/b69471270c69894ccaa104214254e16e441cf97e)]:
  - @proxlane/shared@0.10.0
  - @proxlane/adapters@0.8.0

## 0.11.0

### Minor Changes

- [#234](https://github.com/proxlane/proxlane/pull/234) [`7d7c7ce`](https://github.com/proxlane/proxlane/commit/7d7c7cee2818c48348046a6d4d54932f7296716e) Thanks [@scarsam](https://github.com/scarsam)! - Responses now carry `X-Ignored-Params` naming any query parameter the gateway does not read. `js_render` is ScrapingBee's spelling of `render` and `js` is Scrapfly's; sending either returned HTTP 200 with an unrendered page at a fifth of the cost, and nothing said so.

### Patch Changes

- Updated dependencies [[`1f955e8`](https://github.com/proxlane/proxlane/commit/1f955e823f348a2d4aca85780e3597641772868d)]:
  - @proxlane/adapters@0.7.5

## 0.10.3

### Patch Changes

- Updated dependencies [[`a0d6487`](https://github.com/proxlane/proxlane/commit/a0d64874940e548b8f8f2e58c6903c6fc5caf5e4)]:
  - @proxlane/adapters@0.7.4

## 0.10.2

### Patch Changes

- Updated dependencies [[`a9c624e`](https://github.com/proxlane/proxlane/commit/a9c624e1d20fa558636d0de593b7e5745d1a9580), [`a43b34e`](https://github.com/proxlane/proxlane/commit/a43b34e76ded21c2a2f623e02a2b7cae5fcbe4a3)]:
  - @proxlane/adapters@0.7.3
  - @proxlane/shared@0.9.0

## 0.10.1

### Patch Changes

- Updated dependencies [[`71a0421`](https://github.com/proxlane/proxlane/commit/71a042118619c7e1d4809fc1571bd4cb8b5c6022)]:
  - @proxlane/adapters@0.7.2

## 0.10.0

### Minor Changes

- [#194](https://github.com/proxlane/proxlane/pull/194) [`3302c1c`](https://github.com/proxlane/proxlane/commit/3302c1c4ce77e02926a5f50404db44f1c00a0421) Thanks [@scarsam](https://github.com/scarsam)! - A block no longer cools every premium tier. `cd:blk` now carries the tier the request asked for, so
  a plain request that gets blocked stops suppressing the stealth retry — the escalation most likely
  to work, and the reason the tier exists. The implication still runs downward: a block at stealth
  cools residential and plain too, because they are strictly weaker against the same defence.

  `/health/cooldowns` reports the tier. Existing armed keys are in the old format and are ignored
  rather than migrated; they expire on their own within the cap.

- [#193](https://github.com/proxlane/proxlane/pull/193) [`bd8942b`](https://github.com/proxlane/proxlane/commit/bd8942b80692392b42515c0ae3727df83dc1f134) Thanks [@scarsam](https://github.com/scarsam)! - A cooldown no longer truncates the chain. When every provider the walk tried has failed, one
  cooled provider is attempted before giving up — the same single per-domain slot the existing floor
  uses. Previously a chain whose best provider happened to be cooling could fail on all the others
  and return a provider fault having never tried the one that would have worked.

### Patch Changes

- Updated dependencies [[`3302c1c`](https://github.com/proxlane/proxlane/commit/3302c1c4ce77e02926a5f50404db44f1c00a0421)]:
  - @proxlane/shared@0.8.0
  - @proxlane/adapters@0.7.1

## 0.9.0

### Minor Changes

- [#188](https://github.com/proxlane/proxlane/pull/188) [`7e77a6d`](https://github.com/proxlane/proxlane/commit/7e77a6d09b470c77cdec25ff205d64f4bf930fb5) Thanks [@scarsam](https://github.com/scarsam)! - A challenge page served with a target 5xx is now recognised as a block instead of being reported as
  `TARGET_ERROR`. The detector only ever examined `OK` responses, so Cloudflare's under-attack mode —
  which answers 503 — came back as "the site is broken" when the truth was that the site's defences
  refused every provider. It also armed no cooldown, so every later request re-bought the same
  failures.

  A claimed success that returned zero bytes is no longer billed as a successful scrape.

- [#182](https://github.com/proxlane/proxlane/pull/182) [`7d44744`](https://github.com/proxlane/proxlane/commit/7d4474488c6d254e48e10b69e95530fde99d66eb) Thanks [@scarsam](https://github.com/scarsam)! - The request-body cap now stops the read instead of measuring it afterwards. `c.req.text()`
  resolved only once the whole body was in memory, so an oversized POST was refused having already
  paid the allocation the cap exists to prevent.

  A client that disconnects now aborts the in-flight provider request instead of leaving the chain
  walking every provider for the full deadline. It is reported as its own outcome, never as
  `PROVIDER_TIMEOUT` — blaming a healthy provider for a caller hanging up would cool it and feed the
  health statistic a failure nobody caused.

- [#170](https://github.com/proxlane/proxlane/pull/170) [`84e83ce`](https://github.com/proxlane/proxlane/commit/84e83cecd0218db1ffce4c75c7e22d7a6f8e3df4) Thanks [@scarsam](https://github.com/scarsam)! - Capabilities can now describe a combination a provider refuses even though it offers each part
  alone. ScraperAPI's sessions and premium proxies are mutually exclusive by their own
  documentation, and the router used to send requests asking for both. Declared as data rather than
  a predicate, so `proxlane providers` prints it.

- [#179](https://github.com/proxlane/proxlane/pull/179) [`8c05ff9`](https://github.com/proxlane/proxlane/commit/8c05ff918d74b70b6bff758469daaad906a08b80) Thanks [@scarsam](https://github.com/scarsam)! - Scrapfly's stealth tier is priced at the residential figures, which is what it costs: `translate()`
  sends the residential proxy pool for every tier above `none`, so a stealth request is a residential
  request. It was published at the datacenter base — 1x against a real 25x on the comparison page.

  The router now reads the cost matrix as a capability claim. A null cell means the provider does not
  sell that combination, and ScrapingBee's stealth-without-rendering is one — it was being routed
  there and paid for.

- [#171](https://github.com/proxlane/proxlane/pull/171) [`b0bf5b4`](https://github.com/proxlane/proxlane/commit/b0bf5b41800ba5a7196e8966e21f5a34d74eab3c) Thanks [@scarsam](https://github.com/scarsam)! - Every attempt now records the provider's reported cost, our own table's prediction for the same
  request shape, and which of the two the figure came from. Responses carry `X-Cost-Source`:
  `reported` when the provider told us, `estimated` when we worked it out. This is what makes a
  wrong cost table findable from live traffic instead of by re-reading a vendor's pricing page.

- [#181](https://github.com/proxlane/proxlane/pull/181) [`bb6348d`](https://github.com/proxlane/proxlane/commit/bb6348d23895edbf5efd2a21419d852980679205) Thanks [@scarsam](https://github.com/scarsam)! - A provider's own `Retry-After` now reaches the caller. `ParsedResult.retryAfterMs` had been in the
  contract since it landed and the chain already armed cooldowns from it, but no adapter ever set
  it — so a provider that capped us and said exactly how long to wait had that answer discarded, the
  cooldown drew a 30s jittered guess, and the caller got a bare 429.

  Two chain fixes: an answered request whose next candidate lost its probe claim kept only the
  outcome name, dropping the provider, the body and the detect rule. And a throwing health store
  could make the chain re-attempt — and re-pay for — a provider it had already tried.

### Patch Changes

- Updated dependencies [[`7d5c835`](https://github.com/proxlane/proxlane/commit/7d5c83592cfcc40281fdb9d465f020f922083282), [`7e77a6d`](https://github.com/proxlane/proxlane/commit/7e77a6d09b470c77cdec25ff205d64f4bf930fb5), [`84e83ce`](https://github.com/proxlane/proxlane/commit/84e83cecd0218db1ffce4c75c7e22d7a6f8e3df4), [`8c05ff9`](https://github.com/proxlane/proxlane/commit/8c05ff918d74b70b6bff758469daaad906a08b80), [`4468690`](https://github.com/proxlane/proxlane/commit/4468690161f5e5c2b1f87d3839854d0f2849b07c), [`1248872`](https://github.com/proxlane/proxlane/commit/12488726f08b9e2dc0c047a56d56a4d926ac9625), [`292e67b`](https://github.com/proxlane/proxlane/commit/292e67b7fc1ec912a64910b88ae503e9b3180774), [`bb6348d`](https://github.com/proxlane/proxlane/commit/bb6348d23895edbf5efd2a21419d852980679205), [`df7a4c0`](https://github.com/proxlane/proxlane/commit/df7a4c0ba816b444c970433ab0625147714ae81b)]:
  - @proxlane/adapters@0.7.0
  - @proxlane/detect@0.3.0
  - @proxlane/shared@0.7.1

## 0.8.0

### Minor Changes

- [#142](https://github.com/proxlane/proxlane/pull/142) [`d8f0661`](https://github.com/proxlane/proxlane/commit/d8f06614cc3c2279b06b222a85dc1f3524bfb048) Thanks [@scarsam](https://github.com/scarsam)! - The global deadline defaults to 120s, which `operations.md` decided some time ago and the
  gateway never picked up. At 90s a three-hop chain gave the terminal provider 38s of its 70s cap,
  because the budget reserves time for every hop still to come. The hop that exists to rescue a
  failing request was the one being cut short.

  Callers still ask for less via `timeout` and never for more. The operator's deadline is the
  ceiling, because it bounds how long one request holds an in-flight slot.

### Patch Changes

- Updated dependencies [[`fd84d98`](https://github.com/proxlane/proxlane/commit/fd84d98b7830db868079f68309c5b533cbb6474b), [`935ab4e`](https://github.com/proxlane/proxlane/commit/935ab4e0f67e7c9ada38c541c4db4203fe6ebe1a), [`dc62320`](https://github.com/proxlane/proxlane/commit/dc623207db4dec332def4a37ef9e1097a80db9ec), [`2a9142d`](https://github.com/proxlane/proxlane/commit/2a9142d9fb41baca8914fc6146966ea16d32584e), [`30c894a`](https://github.com/proxlane/proxlane/commit/30c894aa8d4c86b10b6f7e7f6ec78b01dd85a7ac), [`ea6e393`](https://github.com/proxlane/proxlane/commit/ea6e39310d697ff52697f760fd27a4dd1428965b), [`b322019`](https://github.com/proxlane/proxlane/commit/b3220195158a2162cfce7c518a12a5600ac03b2b), [`a342613`](https://github.com/proxlane/proxlane/commit/a3426138432009ead7c2fe507d0ff3f94d011a19), [`2690ec7`](https://github.com/proxlane/proxlane/commit/2690ec70f27cde5529160829950ab5d3e7afda88), [`d8f0661`](https://github.com/proxlane/proxlane/commit/d8f06614cc3c2279b06b222a85dc1f3524bfb048), [`9127601`](https://github.com/proxlane/proxlane/commit/91276017d7146a72a6467236eb216108fdf9cdbb), [`d9525c0`](https://github.com/proxlane/proxlane/commit/d9525c0e3619f4619bd081d82362e6ae2f21d20a), [`40897dc`](https://github.com/proxlane/proxlane/commit/40897dc56281f657e49fb4a471d05795ded3beba), [`6b89f31`](https://github.com/proxlane/proxlane/commit/6b89f312b442b53d231141356124217438f14e53)]:
  - @proxlane/detect@0.2.0
  - @proxlane/adapters@0.6.0
  - @proxlane/shared@0.7.0

## 0.7.1

### Patch Changes

- [#137](https://github.com/proxlane/proxlane/pull/137) [`8acb6fb`](https://github.com/proxlane/proxlane/commit/8acb6fb2d226d8f4637032a2fcace3dc1dcc9471) Thanks [@scarsam](https://github.com/scarsam)! - `X-Chain` is omitted rather than sent empty when no provider was tried. A request refused before
  the chain starts has no attempts, so 0.7.0 emitted a bare `X-Chain:` — `X-Provider-Used` already
  follows "omitted, never empty" for the same reason.

  The homepage transcript matches the gateway again: the boot banner listed the providers in the
  wrong order and carried no version, and the response was missing `x-chain` and `x-cost-unit`. The
  order now derives from the capability table on the same page. The social card is redrawn from an
  SVG source, having spent six days showing a retired wordmark and claiming three providers.

## 0.7.0

### Minor Changes

- [#136](https://github.com/proxlane/proxlane/pull/136) [`89f92ba`](https://github.com/proxlane/proxlane/commit/89f92ba1af670329d9eca3c15394f04a8803b6ee) Thanks [@scarsam](https://github.com/scarsam)! - A block cooldown that keeps failing now backs off to 6 hours instead of re-arming at a flat 15
  minutes forever. A (provider, domain) that had refused a hundred times running cost 96 paid
  probes a day, 288 for a domain three providers block, all of it re-buying evidence already
  held. Account cooldowns are unchanged: a rate limit resets on its own and is private to one org.

  Because a fully-blocked domain would otherwise go dark for the whole backoff, an all-cooling
  domain now gets one forced attempt, rate-limited per domain and reported as
  `X-Provider-Health: cooling-forced`.

- [#134](https://github.com/proxlane/proxlane/pull/134) [`e103c8f`](https://github.com/proxlane/proxlane/commit/e103c8fc6f64f6d42890eaa65278ca4ee3be041f) Thanks [@scarsam](https://github.com/scarsam)! - `X-Chain` names every attempt as `provider:outcome`, in order, and the request log carries it
  too. `X-Provider-Used` names the winner, so a request that failed over and then succeeded came
  back as a clean 200 that hid the provider which had just cost 22 seconds. Found on the live
  gateway: four requests timed out at one provider, all four failed over and returned 200, and
  identifying the culprit needed `/health/cooldowns`, which expires.

### Patch Changes

- Updated dependencies [[`89f92ba`](https://github.com/proxlane/proxlane/commit/89f92ba1af670329d9eca3c15394f04a8803b6ee)]:
  - @proxlane/shared@0.6.0
  - @proxlane/adapters@0.5.1

## 0.6.0

### Minor Changes

- [#125](https://github.com/proxlane/proxlane/pull/125) [`fc0b684`](https://github.com/proxlane/proxlane/commit/fc0b684a60341478b09c45a6e2cf675109928497) Thanks [@scarsam](https://github.com/scarsam)! - Returning a body byte for byte is now a declared capability, and `binary=true` a request
  parameter. An image request used to return 200 with a corrupted body; it now routes only to
  providers that can carry bytes, or answers `NO_PROVIDER_AVAILABLE`. Three of the four launch
  providers carry binary. ScraperAPI does not — it decodes bodies as UTF-8, and its own API says
  so: `binary_target=true` answers 400, "The file type you are trying to scrape is not supported."

- [#123](https://github.com/proxlane/proxlane/pull/123) [`ae17465`](https://github.com/proxlane/proxlane/commit/ae174650f2803c0f4cb035035306d2b6f12f0649) Thanks [@scarsam](https://github.com/scarsam)! - A cost number now carries its unit, and units are never summed together. Three launch providers
  sell credits and Bright Data bills cents, so `X-Cost-Estimate` was adding one provider credit to
  fifteen hundredths of a cent and reporting the result as a quantity. `CostTable.unit` is required,
  the gateway emits `X-Cost-Unit` beside the figure, and a chain that spent in two units reports
  `mixed` rather than an invented total.

### Patch Changes

- Updated dependencies [[`8e146cd`](https://github.com/proxlane/proxlane/commit/8e146cd6e0a454c00c99e69e70547d642a34778f), [`fc0b684`](https://github.com/proxlane/proxlane/commit/fc0b684a60341478b09c45a6e2cf675109928497), [`ae360a9`](https://github.com/proxlane/proxlane/commit/ae360a9b3f0ebe618c93abc4b47d301a2601f4ff), [`ae17465`](https://github.com/proxlane/proxlane/commit/ae174650f2803c0f4cb035035306d2b6f12f0649), [`0a63439`](https://github.com/proxlane/proxlane/commit/0a63439da4c60c8a43bc42ebedc68f709104ca94)]:
  - @proxlane/adapters@0.5.0
  - @proxlane/shared@0.5.0

## 0.5.0

### Minor Changes

- [#120](https://github.com/proxlane/proxlane/pull/120) [`b6e7891`](https://github.com/proxlane/proxlane/commit/b6e7891f7e120b17b589beab7e92e64583d247b7) Thanks [@scarsam](https://github.com/scarsam)! - One NDJSON line per `/v1` request, to stdout. The gateway logged nothing at all, so the moment it
  was reachable by anyone there was no way to answer who probed it, which domains were scraped,
  which provider served them, or what the outcome mix looked like. Records the target's host rather
  than the URL, because query strings carry credentials. `PROXLANE_LOG=off` to silence it; `proxlane
doctor` reports which.

## 0.4.0

### Minor Changes

- [#113](https://github.com/proxlane/proxlane/pull/113) [`7b4a27a`](https://github.com/proxlane/proxlane/commit/7b4a27a7238d865930cb55656353a7ad1a8b8804) Thanks [@scarsam](https://github.com/scarsam)! - `GET /health` reports the running version, so a deploy can be verified. Publishing an image is
  not deploying it — an orchestrator keeps serving the digest it started with — and there was no
  way to ask what was live.

- [#107](https://github.com/proxlane/proxlane/pull/107) [`e0d94b2`](https://github.com/proxlane/proxlane/commit/e0d94b2d25e1b022ddefc87047dc1fdda1e521eb) Thanks [@scarsam](https://github.com/scarsam)! - A `timeout` query parameter sets the deadline for one request, capped at the server's own.
  `integrations.md` has promised it since the budget arithmetic was written and nothing read it.

  Every error now carries `X-Outcome-Class`, `X-Attempts: 0` and `X-Cost-Estimate: 0.000000`.
  Four paths shipped without them, including a missing `url`. A forced provider that does not
  exist now says so and names the ones that do, rather than "no providers configured".

- [#105](https://github.com/proxlane/proxlane/pull/105) [`1e3ea1f`](https://github.com/proxlane/proxlane/commit/1e3ea1f426d5b055da823eb080b61c88cc59fd6b) Thanks [@scarsam](https://github.com/scarsam)! - Retry the last provider in the chain once before giving up, on `PROVIDER_ERROR` and
  `PROVIDER_TIMEOUT` only. Set `PROXLANE_TERMINAL_RETRIES` to change it, 0 to switch it off.
  Everywhere else in the chain, failover is still the retry.

### Patch Changes

- [#101](https://github.com/proxlane/proxlane/pull/101) [`401548f`](https://github.com/proxlane/proxlane/commit/401548fcdd73fef2e64381ffbba28760435d444c) Thanks [@scarsam](https://github.com/scarsam)! - Bump every GitHub Action to a major that targets Node 24. GitHub was already force-running the
  Node 20 ones and warning on each release. Includes `changesets/action` v2, whose breaking
  change moves the custom token from an environment variable to a `github-token` input — left
  alone, the release PR would have silently reverted to the default token and arrived with no
  checks.

- [#102](https://github.com/proxlane/proxlane/pull/102) [`79128ab`](https://github.com/proxlane/proxlane/commit/79128abe82a9214649c6801b69fe273517bc8f47) Thanks [@scarsam](https://github.com/scarsam)! - Pin `changesets/action` back to v1. Its v2 requires Changesets CLI v3 and refuses to run
  against the v2 CLI this repo pins, and it renames every input. Moving it is a release-path
  migration behind a CLI major, not a version bump. v1 already targets Node 24, so it was never
  part of the deprecation.

- [#111](https://github.com/proxlane/proxlane/pull/111) [`258e5fc`](https://github.com/proxlane/proxlane/commit/258e5fc227c795fa6fad07fd57734bfe3f05e5f2) Thanks [@scarsam](https://github.com/scarsam)! - `proxlane outcomes` now says what to do about an outcome, not only what it means: an `action`, a
  sentence of why, and a link to the class's docs section. The policy fields describe what the
  gateway does internally — `failover: true` on a blocked outcome means every provider was already
  tried — which is the opposite of what a caller reading it as "retryable" would conclude.

  Error responses and the CLI both link to `proxlane.dev/docs/outcomes`, which is live. They
  pointed at GitHub because `docs.proxlane.dev` has no DNS record; it was the subdomain that never
  existed, not the docs.

- [#114](https://github.com/proxlane/proxlane/pull/114) [`f40b2c4`](https://github.com/proxlane/proxlane/commit/f40b2c40616db4a950b5505ad93ca8322f4dbb40) Thanks [@scarsam](https://github.com/scarsam)! - The release now tags the gateway image with the version it actually released. It read the
  working tree, which `changeset version` had already bumped, so every push to main published an
  image tagged with the _pending_ version — `0.3.3` and `0.4.0` exist on ghcr while main has been
  `0.3.2` throughout — and re-pointed that tag at a new digest each time.
- Updated dependencies [[`e7dc4a4`](https://github.com/proxlane/proxlane/commit/e7dc4a4cd1d3418bd7f43205099f1abdfb142c75), [`d3ff8c2`](https://github.com/proxlane/proxlane/commit/d3ff8c279b3d3725664559dbe882237dc2006ac5), [`4db45e1`](https://github.com/proxlane/proxlane/commit/4db45e18b32cda1851749b33ec605fd15f800cfe), [`258e5fc`](https://github.com/proxlane/proxlane/commit/258e5fc227c795fa6fad07fd57734bfe3f05e5f2)]:
  - @proxlane/adapters@0.4.0
  - @proxlane/shared@0.4.0

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
