# @proxlane/route-viz

## 0.2.1

### Patch Changes

- [#110](https://github.com/proxlane/proxlane/pull/110) [`cdc85ce`](https://github.com/proxlane/proxlane/commit/cdc85ce4d22c9c873aeb24fc3aae948246ec9c2a) Thanks [@scarsam](https://github.com/scarsam)! - A shed request is drawn struck at the door with a hairline leader to its outcome, not running
  the full width. It had the geometry of the winning leg, so the one request that entered no
  provider's line was drawn travelling further than a success.

## 0.2.0

### Minor Changes

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

### Patch Changes

- e744d94: Three fixes from a visual pass. The docs page title used an em dash as a separator, which
  reads as part of the title in a truncated browser tab; it is a middle dot now. The shed
  request in the route diagram stopped short of its own outcome label, leaving a line ending in
  mid-air; it now reaches the terminus column, because a shed request has no provider to fall
  short of. And a Python sample imported two modules on one line, against PEP 8.

## 0.1.0

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
- c2e9478: `@theme static`, without which Tailwind tree-shook two provider line colours out of the built CSS and the route diagram rendered a provider's leg invisible. `tokens:check` now refuses a bare `@theme`.
