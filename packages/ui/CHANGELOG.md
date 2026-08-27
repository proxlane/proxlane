# @proxlane/ui

## 0.2.4

### Patch Changes

- [#227](https://github.com/proxlane/proxlane/pull/227) [`cc2558c`](https://github.com/proxlane/proxlane/commit/cc2558cdc2d767bd61dffdbc57adc21258538c22) Thanks [@scarsam](https://github.com/scarsam)! - The header's star link carries GitHub's own mark rather than a generic star glyph. The path is
  Octicons' `mark-github-16`, read from source and committed, not embedded: GitHub ships a star
  button and it is an iframe from a third-party host, which is the thing `design.md` self-hosts the
  fonts to avoid.

  `--color-brand-github` is the one brand token whose dark value is a different colour rather than
  a lighter one. GitHub's published black is `[#181717](https://github.com/proxlane/proxlane/issues/181717)`, which measures 17.1:1 on the light ground
  and 1.01:1 on the ink ground, where it vanishes. Their mark inverts by design, so the token does
  too, and `tokens:check` holds both values to the same floor as the deploy buttons.

  Still no count: a build-time one goes stale between deploys, a live one needs the embed, and a
  small number beside an ask reads worse than no number.

## 0.2.3

### Patch Changes

- [#202](https://github.com/proxlane/proxlane/pull/202) [`f26dbc3`](https://github.com/proxlane/proxlane/commit/f26dbc3e875e371e68f3c639789b9dcfc18aebc6) Thanks [@scarsam](https://github.com/scarsam)! - Two accessibility defects on the homepage, both found by running `pnpm lighthouse:assert` for the
  first time in a while.

  The deploy buttons printed their price at 60% of the host's brand colour, which measured 2.46:1.
  DigitalOcean's published blue is 4.51:1 at full strength, so any dimming at all put it under the
  floor. The price is smaller and lighter now rather than fainter, and both brand tokens are held
  to 5:1 by `tokens:check` — above WCAG on purpose, because a threshold cleared by a hundredth is
  satisfied and still fragile, which is exactly how this shipped.

  The mobile menu was `aria-hidden` while closed and its links stayed focusable, so a keyboard user
  tabbed into an invisible sheet. It is `inert` when closed now.

  Accessibility is back to 100.

## 0.2.2

### Patch Changes

- 799fb1e: Fix the search dialog's backdrop in dark mode. It was mixed from `--color-ink`, which inverts
  with the theme, so on dark it was 45% near-white and fogged the page grey instead of dimming
  it. Adds a `--color-scrim` token that darkens in both themes, deeper on dark where the page is
  already dark.

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
