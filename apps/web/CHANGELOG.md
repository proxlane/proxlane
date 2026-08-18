# @proxlane/web

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
