# @proxlane/ui

## 0.2.1

### Patch Changes

- 3e9b1d3: Quieten the schematic background field, which was reading as ruling behind the type: the rule
  mixes into the ground at 22% instead of 42%, the cell grows to 128px, and the mask fades from
  30%. Density mattered as much as contrast — at 96px a 1440px viewport carried fifteen columns
  of line.

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

### Patch Changes

- 11b5428: Craft-floor pass: drawn icons instead of unicode glyphs, themed browser surfaces, the hero-metric card grid replaced with prose, and the single authored motion moment `design.md` asks for.
- c2e9478: `@theme static`, without which Tailwind tree-shook two provider line colours out of the built CSS and the route diagram rendered a provider's leg invisible. `tokens:check` now refuses a bare `@theme`.

## 0.1.0

### Minor Changes

- ee399cc: The hand-authored token layer from `design.md`, light and dark built in the same pass, with `tokens:check` enforcing the palette, per-role contrast on both grounds, and no raw hex outside the token file.
