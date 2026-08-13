# Proxlane: Design

**Direction D, the transit diagram, is chosen.** This is the design spec: the brief, the
chosen direction, the library stack, the copy rules, and the build notes. It is the only
place any of that is defined — `operations.md` no longer carries a design section.

The three rejected directions, and the comparison that chose between them, are in
`docs/archive/design-directions.md`. Read that only if reopening the decision.

Three failure conditions below are machine-checkable and are enforced by
`pnpm tokens:check`: the ground is never `#0A0A0A`, the paper is never `#F4F1EA`, and no
serif appears anywhere.

## The brief

**Subject.** A gateway that routes scraping requests across providers and switches
lanes when one gets blocked.

**Audience.** Backend and data engineers who already pay for one or more scraping
APIs. They are skeptical of marketing, they judge products by docs quality, and they
have seen four hundred dev-tool landing pages this year.

**The page's single job.** Convince someone to change one hostname. Everything on
the marketing site serves that, and the strongest argument is showing what actually
happens to a request.

**The constraint that shaped the choice.** The signature element must be real product
output, not decoration. The hero visual and the dashboard's request timeline should
be the same component reading the same data shape. A developer audience can tell the
difference between a diagram of a system and a diagram from a system.

**What to avoid, explicitly.** Current AI-generated design clusters around three
looks: cream background with a high-contrast serif and a terracotta accent;
near-black with one acid accent; and broadsheet hairlines with zero radius and dense
columns. The direction below names which cluster it risks drifting toward and what
holds it apart.

---

## The direction: transit diagram

Not the road version. The metro map: providers as coloured lines, a request as a
journey, failover as an interchange. It is the only diagrammatic language most
people already read fluently, and it maps onto the product one-to-one with nothing
left over.

**Palette**

```
--map-ink        #14171A   text and rules
--map-slate      #495057   secondary text
--map-paper      #FBFAF7   ground, near-white and slightly warm
--map-line-1     #0B7285   provider line, teal
--map-line-2     #E8590C   provider line, orange
--map-line-3     #5F3DC4   provider line, violet
```

Line colours are categorical, assigned per provider and reused everywhere: the map,
the dashboard charts, the docs. A developer learns "orange is ScrapingBee" once and
it holds across the whole product.

**Type.** One humanist sans across the entire site, hierarchy from weight only,
which is how transit systems work (Johnston, Frutiger, Transport). Hanken Grotesk or
Public Sans at 400/500/700. Martian Mono for code and readouts. Deliberately no
display face: the diagram is the display element.

**Layout**

```
+------------------------------------------+
|  proxlane          docs  pricing  github  |
|                                           |
|  Your request, rerouted.                  |
|                                           |
|      o----------x                         |
|      |          |                         |
|      |          o---------------o  200 ok |
|      |                                    |
|   request    interchange       response   |
|                                           |
|  [ change one hostname ]  [ read docs ]   |
+------------------------------------------+
```

**Signature.** A live route diagram. Each provider is a line, thickness encodes
traffic share, a broken line means currently blocked for this domain, and an
interchange circle marks a failover. It animates one real request's journey on load.
In the dashboard, the same component renders any request from the log, and in phase
three it renders the per-domain routing table, which is the dataset nobody else can
publish.

**Risk.** Light ground with saturated colour is the least AI-default of the directions
considered, but near-white plus warm grey can slide into the cream cluster if the ground
warms up. Keep the paper near #FBFAF7, never #F4F1EA, and never pair it with a serif.
Those are checked by `pnpm tokens:check`, not by eye.

**Second risk, a real one.** Developer tooling is overwhelmingly dark-first in 2026,
and a light marketing site with a dark dashboard reads as two products. Resolve it
by building the dark variant of this palette from the start: ink ground at #14171A,
paper roles inverted.

**Correction, measured rather than assumed.** This section used to end "the line colours were
chosen to hold up on both". They do not. Against the #14171A ground the light values are teal
3.22:1, orange 5.03:1 and violet **2.53:1** — and violet fails even the 3:1 floor WCAG sets for
graphical objects, before any question of text. So the dark variant lifts each hue instead of
reusing the value: `#22B8CF`, `#FF922B`, `#9775FA`, at 7.56, 8.05 and 5.35:1. Same colour
identity, legible ground. Secondary text needs the same treatment — #495057 is 2.20:1 on ink
and becomes #ADB5BD.

Provider lines are held to **3:1, not 4.5:1**, because they are 3px strokes rather than text;
that is the WCAG threshold for graphical objects. Orange is 3.43:1 on paper, which is correct
for a line and wrong for a paragraph, so the two roles are checked separately. `tokens:check`
enforces the right threshold per role on both grounds.

---

## Why D — decided, not open

The metaphor is exact rather than approximate: lines are providers, interchanges are
failovers, journeys are requests, and there is no part of the vocabulary left doing
nothing. It is the furthest from all three AI-default clusters, and light-first is
genuinely contrarian in this category, which is worth something on a launch day where
every competing link is dark. Its signature element has the longest life: hero on day
one, request timeline in the dashboard, per-domain routing map in phase three, and the
illustration on every `/targets` SEO page. One component, four jobs.

The rejected directions and the full comparison are in
`docs/archive/design-directions.md`.

## Library stack

- **Headless primitives: Base UI.** From the Radix and MUI lineage, so behaviour, focus
  management and ARIA are handled while the visual layer is entirely ours. Unstyled by
  design, which is the point: there is no default theme to escape from, so nothing about
  the result reads as a library's look. Wrapped once in `packages/ui`; application code
  imports only from there. That wrapper *is* the design system, and it keeps a future
  primitive swap to one package.
  **Package: `@base-ui/react`.** Not `@base-ui-components/react`, which is abandoned at
  `1.0.0-rc.0` and is what a model reaches for by default. Version pinned in `CLAUDE.md`.
- **Styling: Tailwind v4** with a hand-authored token layer in CSS variables. v4's
  CSS-first config means tokens live in `@theme` and utilities derive from them, so there
  is no "Tailwind look" unless you use the default palette.
- **Charts: visx.** Recharts has a recognisable default silhouette and the dashboard is
  chart-heavy, so this is where a generic library shows most. (visx v4 shipped mid-2026
  with React 19 support; the earlier concern about it stalling is out of date.)
- **Tables: TanStack Table**, headless, styled by us. Non-negotiable given the request log
  is the core dashboard surface.
- **Motion: Motion** (formerly Framer Motion), used sparingly per the build notes below.
- **Explicitly not shadcn/ui.** It is a great starting point and it is also why a thousand
  sites share a silhouette. We take the same primitives one layer lower.

## Copy rules, site and app

Active voice, sentence case, plain verbs. Name things by what the user controls: "provider
keys", not "credential vault". Errors state what happened and what to do, in the
interface's voice, without apologising. Empty states are invitations: the requests table
with no data says what to run to make a first request, with the curl line ready to copy.

## Build notes for the chosen direction

- Tokens live in `@theme` in Tailwind v4, hand-authored. No default palette.
- Base UI wrapped once in `packages/ui`; application code never imports it directly.
- The route diagram is a package, not a page: `packages/route-viz`, consumed by the
  marketing site, the dashboard, and the SEO page generator.
- Provider line colours live in the adapter registry alongside capabilities and cost
  tables, so adding an adapter assigns its colour once and every surface picks it up.
- Motion: one orchestrated sequence on load, nothing on scroll.
  `prefers-reduced-motion` renders the completed diagram immediately.
- Dark variant built in the same pass, not retrofitted.
- Quality floor, never announced: responsive to 360px, visible keyboard focus,
  contrast checked on both variants, Lighthouse accessibility 100.
