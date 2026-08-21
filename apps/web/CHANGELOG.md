# @proxlane/web

## 0.7.1

### Patch Changes

- [#171](https://github.com/proxlane/proxlane/pull/171) [`b0bf5b4`](https://github.com/proxlane/proxlane/commit/b0bf5b41800ba5a7196e8966e21f5a34d74eab3c) Thanks [@scarsam](https://github.com/scarsam)! - Every attempt now records the provider's reported cost, our own table's prediction for the same
  request shape, and which of the two the figure came from. Responses carry `X-Cost-Source`:
  `reported` when the provider told us, `estimated` when we worked it out. This is what makes a
  wrong cost table findable from live traffic instead of by re-reading a vendor's pricing page.

- [#178](https://github.com/proxlane/proxlane/pull/178) [`7c8fcbb`](https://github.com/proxlane/proxlane/commit/7c8fcbb6b52b88320486a0299c60f82a67900720) Thanks [@scarsam](https://github.com/scarsam)! - The homepage boot banner printed the provider table's order and called it the routing order. The
  gateway routes Scrapfly ahead of ScrapingBee, so the page named the wrong provider as first to be
  tried and paid. The provider table is now derived from the capability registry rather than typed
  out — two of its cells were wrong, ScrapingBee's geography and Scrapfly's rendering multiplier.

- [#174](https://github.com/proxlane/proxlane/pull/174) [`37783d3`](https://github.com/proxlane/proxlane/commit/37783d37d07870d226a04b2fba4d64c21c31499d) Thanks [@scarsam](https://github.com/scarsam)! - Name Bright Data everywhere the site describes what the gateway routes across. Four surfaces
  still said three providers: the OpenAPI summary, the docs quickstart, the meta description and
  the docs index.
- Updated dependencies [[`7d5c835`](https://github.com/proxlane/proxlane/commit/7d5c83592cfcc40281fdb9d465f020f922083282), [`84e83ce`](https://github.com/proxlane/proxlane/commit/84e83cecd0218db1ffce4c75c7e22d7a6f8e3df4), [`8c05ff9`](https://github.com/proxlane/proxlane/commit/8c05ff918d74b70b6bff758469daaad906a08b80), [`1248872`](https://github.com/proxlane/proxlane/commit/12488726f08b9e2dc0c047a56d56a4d926ac9625), [`292e67b`](https://github.com/proxlane/proxlane/commit/292e67b7fc1ec912a64910b88ae503e9b3180774), [`bb6348d`](https://github.com/proxlane/proxlane/commit/bb6348d23895edbf5efd2a21419d852980679205), [`df7a4c0`](https://github.com/proxlane/proxlane/commit/df7a4c0ba816b444c970433ab0625147714ae81b)]:
  - @proxlane/adapters@0.7.0
  - @proxlane/shared@0.7.1

## 0.7.0

### Minor Changes

- [#146](https://github.com/proxlane/proxlane/pull/146) [`0875239`](https://github.com/proxlane/proxlane/commit/08752392dcf904d7184f471ca0fb8cd0f8964b96) Thanks [@scarsam](https://github.com/scarsam)! - The site header sticks, and stays transparent until you scroll so it is not a bar sitting on
  the page's background field. Adds a troubleshooting link and a `/symptoms` index, which the four
  symptom pages did not have. Anchor offsets and the docs sidebar move down to clear it.

- [#148](https://github.com/proxlane/proxlane/pull/148) [`06defba`](https://github.com/proxlane/proxlane/commit/06defba051bcb81963e7974d12ba743417c9da82) Thanks [@scarsam](https://github.com/scarsam)! - A mobile menu, so the nav is no longer limited to what fits a 390px pill. One call to action in
  two weights, an accent hairline with a glow rather than three different filled buttons. Panels
  scroll horizontally instead of breaking a header value mid-token, with a raspberry scrollbar
  site-wide. The chain selector keeps its label on one row on a phone and scrolls its tabs. The
  troubleshooting index loses its trailing rule and gains an accent on hover.

- [#145](https://github.com/proxlane/proxlane/pull/145) [`42fcbe9`](https://github.com/proxlane/proxlane/commit/42fcbe9b3caa888cf1896191acfeff78ac2a0546) Thanks [@scarsam](https://github.com/scarsam)! - One page per outcome at `/outcomes/*`, generated from the taxonomy rather than written, for the
  reader who pastes `X-Outcome: SOFT_BLOCK` into a search box and gets a table they have to scan.
  `pages:check` holds the generated set, the sitemap and the route to each other, and keeps two
  blocked decisions blocked.

- [#149](https://github.com/proxlane/proxlane/pull/149) [`b322019`](https://github.com/proxlane/proxlane/commit/b3220195158a2162cfce7c518a12a5600ac03b2b) Thanks [@scarsam](https://github.com/scarsam)! - A block page detector at `/block-page-detector`. Paste a response body and it runs the gateway's
  own detector in your browser, names the rule that fired, and reads the consequence out of the
  same policy table the router uses. Nothing is sent anywhere. `@proxlane/detect` now exports
  `SCAN_BYTES`, so a caller can say how much of a body a verdict was formed from.

- [#144](https://github.com/proxlane/proxlane/pull/144) [`1e98766`](https://github.com/proxlane/proxlane/commit/1e9876671ab17a43c515489058b4e7088d1c9d4e) Thanks [@scarsam](https://github.com/scarsam)! - Four symptom pages at `/symptoms/*`, answering the questions people actually search when a
  scraper misbehaves: a 403, a 200 with a captcha in the body, a Cloudflare challenge surviving a
  headless browser, and identifying a DataDome block. `content:lint` gates them against the
  checklist `operating.md` already specified.

- [#156](https://github.com/proxlane/proxlane/pull/156) [`6b89f31`](https://github.com/proxlane/proxlane/commit/6b89f312b442b53d231141356124217438f14e53) Thanks [@scarsam](https://github.com/scarsam)! - A scraping API comparison at `/scraping-api-comparison`: pick a request shape and see what each
  provider charges on top of its own base rate, from their published tables. Compares multipliers,
  which are dimensionless, and never compares base rates across billing units. Fixes Bright Data's
  base cost, which was a hundred times too low — the only provider whose cost we estimate rather
  than read off the response. `@proxlane/shared` gains an `./error-body` subpath so `@proxlane/adapters`
  no longer drags `node:crypto` into anything that imports it.

### Patch Changes

- [#157](https://github.com/proxlane/proxlane/pull/157) [`b22ac4a`](https://github.com/proxlane/proxlane/commit/b22ac4af4c0711deddaed8cf359dd685e4dae1b4) Thanks [@scarsam](https://github.com/scarsam)! - The focus ring on the detector's textarea is a hairline with a soft glow rather than a 2px
  raspberry rectangle. Around a full-height control the old one read as an error state, which is
  what that colour means everywhere else on the site.

- [#150](https://github.com/proxlane/proxlane/pull/150) [`856f7e0`](https://github.com/proxlane/proxlane/commit/856f7e09856f33ef13ffe8349ce374da2e61e478) Thanks [@scarsam](https://github.com/scarsam)! - The mobile menu overlays the page instead of pushing it down, closes on Escape or a tap outside,
  and draws its destinations as stations on a line with the current page filled in. The terminal
  transcripts scroll sideways rather than breaking a command mid-URL.

- [#139](https://github.com/proxlane/proxlane/pull/139) [`a5ad3df`](https://github.com/proxlane/proxlane/commit/a5ad3dfd328d1b1298024edaf0d23012784c5b0b) Thanks [@scarsam](https://github.com/scarsam)! - The response-header panel no longer breaks header names mid-word or clip long values. `x-chain`
  is much longer than anything else on the page, and a `1fr` grid track will not shrink below its
  content, so it took the width out of the name column beside it and still overflowed.

- [#159](https://github.com/proxlane/proxlane/pull/159) [`a30e357`](https://github.com/proxlane/proxlane/commit/a30e3575e5dca5f3fa66e6b2a985d5b84b144fed) Thanks [@scarsam](https://github.com/scarsam)! - The mobile menu is exactly as wide as the header pill it hangs from, at every width, and both go
  opaque while it is open. The scrim is dark in both themes, so a translucent surface over it
  rendered the light theme's near-white menu as mid-grey.

- [#154](https://github.com/proxlane/proxlane/pull/154) [`72e6f06`](https://github.com/proxlane/proxlane/commit/72e6f06ffbaaf79975f6a3c5f8fdb7ff385823c6) Thanks [@scarsam](https://github.com/scarsam)! - The nav marks the page you are on, the menu's track runs through the centre of its stations
  instead of four pixels to the right of them, and the full nav row only appears at the width it
  actually fits — below 740px "Get started" was wrapping to two lines inside its own pill.

- [#143](https://github.com/proxlane/proxlane/pull/143) [`9a160f1`](https://github.com/proxlane/proxlane/commit/9a160f1b4b7b615e9f99a3a90d342cdc08a074e4) Thanks [@scarsam](https://github.com/scarsam)! - `Panel`, `Transcript` and `CopyButton` move out of the landing-page route into
  `components/artifacts.tsx`, so a second page can use them. Pure move, no visual change. They
  also get their first tests, which is only possible now that something can import them.

- [#147](https://github.com/proxlane/proxlane/pull/147) [`267d357`](https://github.com/proxlane/proxlane/commit/267d357720e2f664079cf7398cb88991d4245a4b) Thanks [@scarsam](https://github.com/scarsam)! - The sticky header actually paints now. It emitted `bg-transparent` and its own override in one
  class list, so Tailwind's layer order picked the transparent one while the blur applied anyway:
  the header blurred the text behind it and put nothing on top. It is a floating glass pill, with
  a scrim so content dissolves under it rather than being sliced.

  Also fixes a hydration bug that broke the whole site's client JS: an `@proxlane/shared` barrel
  import pulled `node:crypto` into the browser bundle.

- [#161](https://github.com/proxlane/proxlane/pull/161) [`23bfca6`](https://github.com/proxlane/proxlane/commit/23bfca6a5801453995d66db313791c2beba4b252) Thanks [@scarsam](https://github.com/scarsam)! - Code blocks look the same everywhere. A lone fence in the docs now renders in the framed,
  labelled window the homepage and tab groups already used, and the copy control sits in that bar
  with the same icon and label instead of a text-only button floating over the corner on hover.

- [#167](https://github.com/proxlane/proxlane/pull/167) [`2690ec7`](https://github.com/proxlane/proxlane/commit/2690ec70f27cde5529160829950ab5d3e7afda88) Thanks [@scarsam](https://github.com/scarsam)! - The FAQ said the detector's rules had never seen a real block page. Five of six have now been
  confirmed against one, and five of six turned out to have a defect only a real page could show.

- [#162](https://github.com/proxlane/proxlane/pull/162) [`d9525c0`](https://github.com/proxlane/proxlane/commit/d9525c0e3619f4619bd081d82362e6ae2f21d20a) Thanks [@scarsam](https://github.com/scarsam)! - Whether a detection rule has been confirmed by a real block page is now derived from stored
  captures rather than a hand-set boolean. `pnpm corpus:verify` runs every capture through the real
  detector and generates the table, recording each capture's SHA-256, so a claim points at an
  artefact. `cloudflare-challenge` is the first rule confirmed against the thing it describes.
- Updated dependencies [[`fd84d98`](https://github.com/proxlane/proxlane/commit/fd84d98b7830db868079f68309c5b533cbb6474b), [`935ab4e`](https://github.com/proxlane/proxlane/commit/935ab4e0f67e7c9ada38c541c4db4203fe6ebe1a), [`dc62320`](https://github.com/proxlane/proxlane/commit/dc623207db4dec332def4a37ef9e1097a80db9ec), [`2a9142d`](https://github.com/proxlane/proxlane/commit/2a9142d9fb41baca8914fc6146966ea16d32584e), [`30c894a`](https://github.com/proxlane/proxlane/commit/30c894aa8d4c86b10b6f7e7f6ec78b01dd85a7ac), [`ea6e393`](https://github.com/proxlane/proxlane/commit/ea6e39310d697ff52697f760fd27a4dd1428965b), [`b322019`](https://github.com/proxlane/proxlane/commit/b3220195158a2162cfce7c518a12a5600ac03b2b), [`a342613`](https://github.com/proxlane/proxlane/commit/a3426138432009ead7c2fe507d0ff3f94d011a19), [`2690ec7`](https://github.com/proxlane/proxlane/commit/2690ec70f27cde5529160829950ab5d3e7afda88), [`d8f0661`](https://github.com/proxlane/proxlane/commit/d8f06614cc3c2279b06b222a85dc1f3524bfb048), [`9127601`](https://github.com/proxlane/proxlane/commit/91276017d7146a72a6467236eb216108fdf9cdbb), [`d9525c0`](https://github.com/proxlane/proxlane/commit/d9525c0e3619f4619bd081d82362e6ae2f21d20a), [`40897dc`](https://github.com/proxlane/proxlane/commit/40897dc56281f657e49fb4a471d05795ded3beba), [`6b89f31`](https://github.com/proxlane/proxlane/commit/6b89f312b442b53d231141356124217438f14e53)]:
  - @proxlane/detect@0.2.0
  - @proxlane/adapters@0.6.0
  - @proxlane/shared@0.7.0

## 0.6.0

### Minor Changes

- [#137](https://github.com/proxlane/proxlane/pull/137) [`8acb6fb`](https://github.com/proxlane/proxlane/commit/8acb6fb2d226d8f4637032a2fcace3dc1dcc9471) Thanks [@scarsam](https://github.com/scarsam)! - `X-Chain` is omitted rather than sent empty when no provider was tried. A request refused before
  the chain starts has no attempts, so 0.7.0 emitted a bare `X-Chain:` — `X-Provider-Used` already
  follows "omitted, never empty" for the same reason.

  The homepage transcript matches the gateway again: the boot banner listed the providers in the
  wrong order and carried no version, and the response was missing `x-chain` and `x-cost-unit`. The
  order now derives from the capability table on the same page. The social card is redrawn from an
  SVG source, having spent six days showing a retired wordmark and claiming three providers.

## 0.5.0

### Minor Changes

- [#132](https://github.com/proxlane/proxlane/pull/132) [`9423cd4`](https://github.com/proxlane/proxlane/commit/9423cd44f215cd7cdfd2e4ee651c04b34305685c) Thanks [@scarsam](https://github.com/scarsam)! - A FAQ page at `/docs/faq`, answering the questions an evaluator actually asks before the
  quickstart: what this is against calling a provider directly, whether code has to change,
  what happens during an outage, what happens to provider API keys, and what the gateway logs.
  Every answer is shipped behaviour, and the provider list points at the generated table rather
  than repeating a count that would go stale.

### Patch Changes

- Updated dependencies [[`89f92ba`](https://github.com/proxlane/proxlane/commit/89f92ba1af670329d9eca3c15394f04a8803b6ee)]:
  - @proxlane/shared@0.6.0

## 0.4.2

### Patch Changes

- Updated dependencies [[`fc0b684`](https://github.com/proxlane/proxlane/commit/fc0b684a60341478b09c45a6e2cf675109928497)]:
  - @proxlane/shared@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies [[`258e5fc`](https://github.com/proxlane/proxlane/commit/258e5fc227c795fa6fad07fd57734bfe3f05e5f2), [`cdc85ce`](https://github.com/proxlane/proxlane/commit/cdc85ce4d22c9c873aeb24fc3aae948246ec9c2a)]:
  - @proxlane/shared@0.4.0
  - @proxlane/route-viz@0.2.1

## 0.4.0

### Minor Changes

- ad67e35: Document bringing your own provider. Adapters have always been Apache-2.0 specifically so a
  stranger can write one and keep it closed, `pnpm new-adapter` has always scaffolded it, and
  none of that appeared on the site. Records in `state.md` that a free fallback provider stays
  unbuilt until the provider ToS question is answered.

## 0.3.0

### Minor Changes

- 2337fc8: Deploy the marketing site to Cloudflare Workers. Adds the Cloudflare Vite plugin, a
  `wrangler.jsonc`, and a path-filtered deploy workflow. The gateway is explicitly not deployed
  this way — Workers has no Node runtime and no undici, which is the reason the gateway runs on
  Node at all.
- ea67d3f: Add a changelog page, generated from the CHANGELOG.md files changesets already writes. It
  cannot fall behind the code without the release process itself having failed. Dependency-bump
  entries are filtered out, since they say a number moved rather than what changed, and a
  release left with nothing is still listed so the version history has no apparent gaps.
- 678bc94: Add cURL, Python and Node tabs to the docs code samples. Switching is a hidden radio group
  and static CSS, so it works with JavaScript off; a small script syncs every group on a page to
  one language and remembers the choice. `docs:check` assertion 10 keeps the plugin's tab cap
  and the stylesheet's rule pairs in agreement, because CSS cannot count and a fifth tab would
  otherwise render a panel nothing can show.
- eef8d3e: Fix the sitemap and close the gaps against reference documentation sites. Seven docs pages
  shipped while `sitemap.xml` still listed one URL, so none of them were discoverable by
  crawlers on a project whose growth model is search. `docs:check` assertion 7 now fails when a
  page is missing from it.

  Adds a copy button on every code block, an "Edit this page on GitHub" link, and prev/next
  navigation. Adds the two agent-facing formats the ownership table has named since the
  scaffold and nothing had built: `llms-full.txt`, and raw markdown at any docs URL plus `.md`.
  Both are generated and asserted byte-identical, the same standard `CODEOWNERS` is held to.

- a4f5e9f: Add search to the docs. The index is built from the same markdown the pages are, one record
  per section rather than per page, and runs entirely in the browser: no third party sees what
  a reader types about a scraping gateway. Cmd+K, Ctrl+K or `/` opens it. `docs:check` assertion
  11 fails when a page is missing from the index, since a page that is silently unsearchable
  reads as a page that does not exist.
- abf833f: Add the docs site. `/docs` was linked from the header and the primary call to action and had
  no route at all, so both 404ed on the live site.

  Pages are markdown in `apps/web/content/docs`, versioned and reviewed like code, rendered to
  HTML at build time by a Vite plugin. Neither `markdown-it` nor Shiki reaches the Worker
  bundle. The outcome reference is generated from the taxonomy instead, because a hand-written
  copy of the thing callers write switch statements against is the one page that must not drift.

  `pnpm docs:check` is now real: it asserts every page has a file, a route and a nav entry,
  that every query parameter and response header the gateway implements is documented, that
  internal links resolve, and that `llms.txt` lists exactly the pages that exist.

  `@proxlane/shared` gains a `./outcome` subpath export, so the taxonomy can be imported
  without pulling the edge guard and `node:crypto` into a browser bundle.

- a27de76: Rework the landing page around why anyone needs this. Adds the problem above the diagram and a
  pricing section, moves detection up so "a 200 is not a success" is not the last thing on the
  page, and makes the quickstart demonstrate the gateway rather than a single-provider CLI call
  with failover switched off. Clarifies that providers do the billing, not us. Fixes the
  wordmark, whose text content read "prxlane", and the footer's licence summary.
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

- 8718eac: Add an OpenAPI 3.1 description at `/openapi.json`, generated from the gateway's own outcome
  taxonomy so its status codes and enums are the ones the router actually uses. Validates clean
  against Redocly. `docs:check` assertion 12 fails when the spec and the handler disagree about
  a parameter, a response header or a route.
- af9df16: Draw the chain that never entered a lane. A route with no attempts used to render as a dot
  and the word `request`, which reads as a broken drawing rather than as a request the gateway
  refused before choosing a provider. It now runs in ink to a stop mark and labels the outcome:
  ink is already the colour of a request that belongs to no provider, so the vocabulary says
  what happened before a label is read.

  The outcome gutter widens for `429 GATEWAY_BUSY`, now the longest terminus label at 16
  characters. The previous sizing was cut to `PROVIDER_ERROR` and would have clipped the new
  one on both widths.

  The landing page gains the shed scenario and shows `server-timing` in the response readout,
  which the gateway emits on every response and the page did not mention.

- 7c594ad: Highlight the station you have scrolled to on the landing page. Its artifact panel takes the
  accent on its border and a soft glow, and the tick joining it to the trunk takes the accent
  too, so the effect reads as a position on the line rather than a box that lit up.

### Patch Changes

- a0db81c: Restore the copy button's styles. They were deleted by an edit that truncated the stylesheet,
  so the button shipped unstyled on every code block. `docs:check` assertion 9 now fails when a
  class the component applies at runtime has no rule in the stylesheet.
- 134190f: Move the on-page contents into the sidebar, nested under the page it belongs to, and make it
  sticky. It previously sat in the content column as a bordered list, which read as a block
  quote rather than as navigation, and it scrolled away as soon as you started reading. The
  current heading is tracked as you scroll, so the list says where you are rather than only
  what exists.
- 799fb1e: Fix the search dialog's backdrop in dark mode. It was mixed from `--color-ink`, which inverts
  with the theme, so on dark it was 45% near-white and fogged the page grey instead of dimming
  it. Adds a `--color-scrim` token that darkens in both themes, deeper on dark where the page is
  already dark.
- e744d94: Three fixes from a visual pass. The docs page title used an em dash as a separator, which
  reads as part of the title in a truncated browser tab; it is a middle dot now. The shed
  request in the route diagram stopped short of its own outcome label, leaving a line ending in
  mid-air; it now reaches the terminus column, because a shed request has no provider to fall
  short of. And a Python sample imported two modules on one line, against PEP 8.
- ceeba4e: Sit the wordmark's ring on the baseline where the real `o` sits, derived from the face's
  measured metrics rather than nudged by eye, and add a social card built from the route diagram.
- 8fb21af: Match the wordmark's ring to the real `o`: an ellipse at the measured ink width rather than a
  circle at the o's height, with the font's own `ro` and `ox` kerning baked into the margins.
- Updated dependencies [abf833f]
- Updated dependencies [c48afba]
- Updated dependencies [4ed05a5]
- Updated dependencies [799fb1e]
- Updated dependencies [af9df16]
- Updated dependencies [e744d94]
  - @proxlane/shared@0.3.0
  - @proxlane/ui@0.2.2
  - @proxlane/route-viz@0.2.0

## 0.2.1

### Patch Changes

- 3e9b1d3: Quieten the schematic background field, which was reading as ruling behind the type: the rule
  mixes into the ground at 22% instead of 42%, the cell grows to 128px, and the mask fades from
  30%. Density mattered as much as contrast — at 96px a 1440px viewport carried fifteen columns
  of line.
- Updated dependencies [3e9b1d3]
  - @proxlane/ui@0.2.1

## 0.2.0

### Minor Changes

- 11b5428: Rebuild the landing page as a technical artifact rather than a page about one.

  The hero is operated instead of watched: three real chains — first hop, failover, exhausted —
  switchable, with the response headers below following the selection. Every case is read off
  `apps/gateway/src`, including the exhausted one where `x-provider-used` is absent because
  nothing served. Each station leads with the artifact in a framed, copyable panel with the
  prose beside it.

  The route diagram gains an origin station, an aligned outcome column with leaders, per-attempt
  latency and detect rule, and a compact geometry so labels hold their size on a phone. Pointing
  at a leg recedes the others.

  Adds a schematic field behind the document and a panel shadow, both mixed from existing colour
  roles so they invert with the theme. The page trunk draws as you scroll it. All motion is CSS,
  respects `prefers-reduced-motion`, and the scroll-driven trunk sits behind `@supports`.

  Adds two colour roles. `--color-accent` (raspberry) is a correction rather than a decoration:
  the focus ring, caret, selection and the migration's curl line were all drawn in
  `--color-line-1`, which is ScraperAPI's colour, so page chrome was claiming to belong to an
  adapter. `--color-surface` separates panels from the page ground, which previously differed
  by one hairline. `tokens:check` now measures contrast against the panel ground as well as the
  page ground — text lives on both, and checking only one was a narrower measurement than the
  claim it supported.

  Swaps Martian Mono for IBM Plex Mono. Martian is a display mono at a 0.72em advance; on a page
  whose artifacts are transcripts it forced 79-character lines to need a 918px column and clipped
  labels twice.

- d299128: The route diagram: one request's journey drawn from attempt data, with provider line colours assigned in the adapter registry so every surface picks them up from one place.

### Patch Changes

- 11b5428: Craft-floor pass: drawn icons instead of unicode glyphs, themed browser surfaces, the hero-metric card grid replaced with prose, and the single authored motion moment `design.md` asks for.
- b391762: Implement `pnpm lighthouse:assert` against a real production build, and add the favicon whose
  absence it found: browsers requested `/favicon.ico`, took a 404, and logged a console error
  that cost the best-practices score. `tokens:check` asserts the favicon's hex still matches
  `--map-accent`, since a standalone SVG cannot read the token layer and is the one file where
  the brand can drift alone.
- Updated dependencies [11b5428]
- Updated dependencies [11b5428]
- Updated dependencies [d299128]
- Updated dependencies [c2e9478]
  - @proxlane/ui@0.2.0
  - @proxlane/route-viz@0.1.0

## 0.1.0

### Minor Changes

- 8a9e9dc: TanStack Start replaces the Vite placeholder, consuming the token layer with self-hosted fonts, a theme resolved before first paint, and a hero that shows the one-hostname migration as a diff rather than describing it.

### Patch Changes

- Updated dependencies [ee399cc]
  - @proxlane/ui@0.1.0
