---
"@proxlane/route-viz": minor
"@proxlane/ui": minor
"@proxlane/web": minor
---

Rebuild the landing page as a technical artifact rather than a page about one.

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
