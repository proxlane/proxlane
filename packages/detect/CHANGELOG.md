# @proxlane/detect

## 0.3.1

### Patch Changes

- [#248](https://github.com/proxlane/proxlane/pull/248) [`c798431`](https://github.com/proxlane/proxlane/commit/c7984315e320c203d99fce7dd4872203caa26d61) Thanks [@scarsam](https://github.com/scarsam)! - The verified-rules table now claims only what a retained capture can prove. It cited six captures across five rules and one of those artefacts still existed; the rest were lost with no backup, while the docs site went on reporting those rules as confirmed. `verified.ts` is generated precisely so a claim names an artefact, so a claim whose artefact is gone is not verified — the table reads 2 of 6, and `imperva-incapsula` joins it on a positive capture taken from live traffic. `corpus:verify` also names which claims a mounted corpus cannot back on its read-only path, rather than calling a shrinking table and a growing one both "stale".

- [#251](https://github.com/proxlane/proxlane/pull/251) [`8caef80`](https://github.com/proxlane/proxlane/commit/8caef808d5e259b69000baaf27e5dbca6f3a20d1) Thanks [@scarsam](https://github.com/scarsam)! - Restores the five verified detection rules retracted earlier today. The captures behind them were never lost — they live in the private `proxlane/corpus` repository, which nothing in the repo mentioned, so an exhaustive search of one machine concluded the evidence was gone. All six rules are confirmed by a real capture, from nine captures in total. `corpus:verify`'s refusal now names the repo to clone before anyone reaches for `--allow-retractions` again.

## 0.3.0

### Minor Changes

- [#188](https://github.com/proxlane/proxlane/pull/188) [`7e77a6d`](https://github.com/proxlane/proxlane/commit/7e77a6d09b470c77cdec25ff205d64f4bf930fb5) Thanks [@scarsam](https://github.com/scarsam)! - A challenge page served with a target 5xx is now recognised as a block instead of being reported as
  `TARGET_ERROR`. The detector only ever examined `OK` responses, so Cloudflare's under-attack mode —
  which answers 503 — came back as "the site is broken" when the truth was that the site's defences
  refused every provider. It also armed no cooldown, so every later request re-bought the same
  failures.

  A claimed success that returned zero bytes is no longer billed as a successful scrape.

### Patch Changes

- [#186](https://github.com/proxlane/proxlane/pull/186) [`4468690`](https://github.com/proxlane/proxlane/commit/4468690161f5e5c2b1f87d3839854d0f2849b07c) Thanks [@scarsam](https://github.com/scarsam)! - Every published package now has a description, keywords, a homepage and a README. Four of the five
  rendered "ERROR: No README data found!" on npmjs.com — including `@proxlane/adapters`, the
  Apache-2.0 package this project most wants strangers to contribute to.

## 0.2.0

### Minor Changes

- [#162](https://github.com/proxlane/proxlane/pull/162) [`d9525c0`](https://github.com/proxlane/proxlane/commit/d9525c0e3619f4619bd081d82362e6ae2f21d20a) Thanks [@scarsam](https://github.com/scarsam)! - Whether a detection rule has been confirmed by a real block page is now derived from stored
  captures rather than a hand-set boolean. `pnpm corpus:verify` runs every capture through the real
  detector and generates the table, recording each capture's SHA-256, so a claim points at an
  artefact. `cloudflare-challenge` is the first rule confirmed against the thing it describes.

### Patch Changes

- [#165](https://github.com/proxlane/proxlane/pull/165) [`fd84d98`](https://github.com/proxlane/proxlane/commit/fd84d98b7830db868079f68309c5b533cbb6474b) Thanks [@scarsam](https://github.com/scarsam)! - A Cloudflare block page is now reported as `cloudflare-blocked` rather than
  `cloudflare-challenge`. Real block pages carry both signatures, and rule order meant the block
  rule could never fire — `X-Detect-Rule` named the wrong reason on every Cloudflare block. Five of
  six detection rules are now confirmed against a real captured page.

- [#160](https://github.com/proxlane/proxlane/pull/160) [`935ab4e`](https://github.com/proxlane/proxlane/commit/935ab4e0f67e7c9ada38c541c4db4203fe6ebe1a) Thanks [@scarsam](https://github.com/scarsam)! - `pnpm capture-block` turns a real HTTP response into a block-page corpus entry. `plan.md` §19
  decides where it lands: a purpose-built scraping sandbox may enter this repository, anything else
  requires a private directory and is refused without one. Captures store a class of target, never
  a hostname, and are scrubbed of provider keys.

- [#166](https://github.com/proxlane/proxlane/pull/166) [`30c894a`](https://github.com/proxlane/proxlane/commit/30c894aa8d4c86b10b6f7e7f6ec78b01dd85a7ac) Thanks [@scarsam](https://github.com/scarsam)! - `imperva-incapsula` no longer fires on ordinary pages. It matched `_Incapsula_Resource`, which is
  how any Incapsula-protected site loads Imperva's client script; it now keys on the structural
  difference — a block page _frames_ that resource, an ordinary page _scripts_ it — which also
  survives Imperva rotating the query parameter. `capture-block` names files by content digest, so
  two captures can no longer overwrite each other.

- [#149](https://github.com/proxlane/proxlane/pull/149) [`b322019`](https://github.com/proxlane/proxlane/commit/b3220195158a2162cfce7c518a12a5600ac03b2b) Thanks [@scarsam](https://github.com/scarsam)! - A block page detector at `/block-page-detector`. Paste a response body and it runs the gateway's
  own detector in your browser, names the rule that fired, and reads the consequence out of the
  same policy table the router uses. Nothing is sent anywhere. `@proxlane/detect` now exports
  `SCAN_BYTES`, so a caller can say how much of a body a verdict was formed from.

- [#164](https://github.com/proxlane/proxlane/pull/164) [`a342613`](https://github.com/proxlane/proxlane/commit/a3426138432009ead7c2fe507d0ff3f94d011a19) Thanks [@scarsam](https://github.com/scarsam)! - `akamai-bot-manager` now matches Akamai's real deny page, whose signature is HTML-entity-encoded
  so the previous literal could never fire on it. Four of six detection rules are now confirmed
  against a real captured block page, up from zero.

- [#167](https://github.com/proxlane/proxlane/pull/167) [`2690ec7`](https://github.com/proxlane/proxlane/commit/2690ec70f27cde5529160829950ab5d3e7afda88) Thanks [@scarsam](https://github.com/scarsam)! - The FAQ said the detector's rules had never seen a real block page. Five of six have now been
  confirmed against one, and five of six turned out to have a defect only a real page could show.

- [#163](https://github.com/proxlane/proxlane/pull/163) [`9127601`](https://github.com/proxlane/proxlane/commit/91276017d7146a72a6467236eb216108fdf9cdbb) Thanks [@scarsam](https://github.com/scarsam)! - `datadome` is confirmed against real DataDome block markup, taking the detector to two rules of
  six backed by a capture. Documents a measured false positive in `imperva-incapsula`: the token it
  matches appears on ordinary pages of Incapsula-protected sites, and only escapes firing because it
  fell outside the scan window on the page tested.

## 0.1.0

### Minor Changes

- b1f13d2: The block detector: `detect(bytes, contentType, charset)` returns the vendor rule that fired, or nothing. Six rules covering Cloudflare, DataDome, PerimeterX, Imperva and Akamai, each anchored to a vendor asset path rather than generic words like "captcha" — a false positive here fails over and spends a second provider's credits.

### Patch Changes

- 25ba49b: Documents a limitation with a real capture: a site that serves its own block page — no Cloudflare, DataDome or Imperva markup — returns 200 with nothing to fingerprint, and the detector calls it `OK`. A rule matching the words would flag any article about bot detection, so catching it needs a per-domain baseline rather than a string match.
