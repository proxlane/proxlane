# @proxlane/web

## 0.9.1

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

- [#224](https://github.com/proxlane/proxlane/pull/224) [`f7f91b2`](https://github.com/proxlane/proxlane/commit/f7f91b2a63d765d0449843335e6b592ddf5b8a71) Thanks [@scarsam](https://github.com/scarsam)! - A JS-only page at `/canary/js.html`, served from this site so the live canary can stop depending
  on somebody else's demo site to prove that providers still render JavaScript. The old target
  failed twice in one morning on two different providers while answering in half a second from a
  laptop, and `operations.md` section 9 counts three consecutive _scheduled_ greens with no way for
  a manual re-run to repair one, so a third party having a bad minute could reset a three-week
  launch clock.

  The marker it looks for appears nowhere in the served HTML — the script assembles it from two
  halves — so a provider returning the unrendered source cannot accidentally satisfy the check.

  The header links to GitHub as `star` rather than `github`. Not GitHub's own button: that is an
  iframe from a third-party host, on a site whose argument is that it does not leak. No count
  either, because a small number next to an ask reads worse than no number.

- [#222](https://github.com/proxlane/proxlane/pull/222) [`3520b2d`](https://github.com/proxlane/proxlane/commit/3520b2d6c33de2df6efc127543ef3d8f53354daa) Thanks [@scarsam](https://github.com/scarsam)! - Three FAQ entries, each answering a question the docs could already answer and a reader could
  not find.

  "What does it cost?" said Proxlane costs nothing, which is true and is not the question anyone
  asks about a failover product. "Does failing over cost me more?" says yes, explains that
  providers bill attempts rather than successes, and points at the two headers that show it. The
  trade is stated rather than sold: failover buys success rate with money, and on easy targets one
  provider is cheaper.

  "Which provider does it try first, and why?" moves the reasoning out of a code comment. The
  default order is deliberate but not evidence-based, a rival's benchmark is not a source to
  reorder production traffic on, and measuring this is what the project is for.

  "What happens when a provider changes their API?" was asked three separate times in the comments
  of the closest comparable launch, and was answered nowhere a reader would look.

- [#230](https://github.com/proxlane/proxlane/pull/230) [`3973441`](https://github.com/proxlane/proxlane/commit/39734410c6b745b04c212790fa423bb13bf4887f) Thanks [@scarsam](https://github.com/scarsam)! - The mobile menu's GitHub entry carries the mark too. Desktop had a branded button and mobile had
  a lowercase word, which is the half of the audience most likely to arrive from a phone.

  The mark moves into its own component rather than being pasted a third time.

  Three FAQ answers are shorter. The three added this morning were 410 words against a median
  section of about sixty, and length was the only thing wrong with them — every other docs page has
  no paragraph over sixty words, and the FAQ had the only two.

  The homepage meta description is 156 characters instead of 205. Link previews cut around 150, so
  the tail — the licence and the fact that you host it yourself — was the part that disappeared.
  Provider names stay, and stay early: they are the terms people search.

- [#230](https://github.com/proxlane/proxlane/pull/230) [`3973441`](https://github.com/proxlane/proxlane/commit/39734410c6b745b04c212790fa423bb13bf4887f) Thanks [@scarsam](https://github.com/scarsam)! - The header link says GitHub rather than Star, because that is what it does. GitHub publishes no
  URL that stars a repository — their own button performs it from inside the iframe this
  deliberately avoids — so a link labelled Star promised an action it could not perform and
  delivered a page instead. The mark carries the invitation; the label should not overstate it.

  It also sits beside the primary call to action now rather than across the theme toggle from it.
  The toggle is a setting; those two are the ways out of the page, and a control wedged between
  them made them read as unrelated.

- Updated dependencies [[`cc2558c`](https://github.com/proxlane/proxlane/commit/cc2558cdc2d767bd61dffdbc57adc21258538c22), [`a0d6487`](https://github.com/proxlane/proxlane/commit/a0d64874940e548b8f8f2e58c6903c6fc5caf5e4)]:
  - @proxlane/ui@0.2.4
  - @proxlane/adapters@0.7.4

## 0.9.0

### Minor Changes

- [#218](https://github.com/proxlane/proxlane/pull/218) [`71a2347`](https://github.com/proxlane/proxlane/commit/71a23472daea61591cadf7c6cdaff968df324a11) Thanks [@scarsam](https://github.com/scarsam)! - The changelog says when. It had no dates anywhere, and its own comment explained why:
  "changesets records no dates". True of changesets, false of this repo — every release cuts a git
  tag and a tag has a date, so the order is read rather than invented.

  A Recent section now merges the last twelve releases across every package, newest first, and the
  intro states the last release date. The question a stranger arrives with is whether the project
  is alive, and a page grouped into five per-package sections could not answer it without being
  read five times and merged in your head.

  The self-credit is stripped. `@changesets/changelog-github` writes "Thanks [@handle]!" on every
  entry, which is the right default and the reason that generator was chosen — it credits
  strangers. On a repo with one maintainer it rendered as the same person thanking themselves forty
  times down one page. Stripped for that handle only, so the first outside contribution is credited
  the moment it lands, and the CHANGELOG files keep the record either way.

  The docs plugin throws when it finds no tags rather than shipping a dateless page, because
  `actions/checkout` is shallow by default: this would have worked on a laptop and quietly lost the
  dates in production.

## 0.8.1

### Patch Changes

- Updated dependencies [[`a9c624e`](https://github.com/proxlane/proxlane/commit/a9c624e1d20fa558636d0de593b7e5745d1a9580), [`a43b34e`](https://github.com/proxlane/proxlane/commit/a43b34e76ded21c2a2f623e02a2b7cae5fcbe4a3)]:
  - @proxlane/adapters@0.7.3
  - @proxlane/shared@0.9.0

## 0.8.0

### Minor Changes

- [#204](https://github.com/proxlane/proxlane/pull/204) [`e7c3a41`](https://github.com/proxlane/proxlane/commit/e7c3a41b9e5d918a93a930b245befb9b8f49a21e) Thanks [@scarsam](https://github.com/scarsam)! - `Accept: text/markdown` on a docs page now returns the markdown. It returned the router's
  serialised loader data, which is worse than a 404 because it looks like a successful answer. Both
  branches send `Vary: Accept, Accept-Encoding` — without it the negotiation is correct exactly
  until a CDN caches one variant and hands it to a caller who asked for the other.

  The check is a q-value comparison, not a substring test. Every browser sends a wildcard, a
  wildcard matches `text/markdown`, and a naive test would have served the site's own source to
  every human visitor while passing any test written for the happy path.

  New `/privacy`. "Nothing phones home" is on every other page and was unsubstantiated; this says
  what actually happens, including the parts that are not flattering. Written from the code rather
  than from intent: no cookies and no analytics were verified against the deployed site, and the
  two localStorage keys are named rather than described as "preferences".

- [#196](https://github.com/proxlane/proxlane/pull/196) [`2e2c8f4`](https://github.com/proxlane/proxlane/commit/2e2c8f4c6cea0aa0bf82808d03c59fd751aaf10c) Thanks [@scarsam](https://github.com/scarsam)! - One-click deploy, on two hosts, in their own colours. The homepage's first call to action is now a
  thing that runs rather than a page that explains: a pinned image on the reader's own account, with
  one provider key asked for. Render is free and sleeps after fifteen minutes idle; DigitalOcean is
  about five dollars a month and stays awake, which for a scraper is often the one that matters. Each
  price is printed on its button rather than discovered at a checkout. Docs and source are links
  underneath rather than two more pills, so the row has one primary action per host and one baseline.

  Both blueprints live in the repo — `render.yaml` and `.do/deploy.template.yaml` — so they can be
  read before they are clicked, and both image tags are written by the release rather than by hand.

  Both also set `PROXLANE_MAX_INFLIGHT=16`. The default of 32 sizes the gateway at 800 MB and these
  instances are 512, so the boot check would have printed the arithmetic and exited rather than being
  OOM-killed later. Correct behaviour, and a crash loop on the one plan the button selects.

### Patch Changes

- [#206](https://github.com/proxlane/proxlane/pull/206) [`de6de06`](https://github.com/proxlane/proxlane/commit/de6de06a9594ceb5d93af75ea1c9881844144db5) Thanks [@scarsam](https://github.com/scarsam)! - The 406 that markdown negotiation returns now says why. Two of the ten docs pages —
  `/docs/outcomes` and `/docs/changelog` — are generated from the outcome taxonomy and from the
  package changelogs rather than written in `content/docs/`, so they have no markdown source to
  serve. The code claimed a missing twin meant a broken build; it does not, and the response body
  now names the reason and points at `llms-full.txt`, which does carry that content.

- [#203](https://github.com/proxlane/proxlane/pull/203) [`9a97791`](https://github.com/proxlane/proxlane/commit/9a977913c5aed3b52afb8647a0a7bf6f3f6d7ce7) Thanks [@scarsam](https://github.com/scarsam)! - Four things an agent reads are now correct or present.

  `llms.txt` — the one file published for machines — summarised the gateway as fronting three
  providers, and had done since the fourth shipped. Every human-facing surface had already been
  corrected. `docs:check` now holds its summary block to the registry.

  The 404 was the words "Not Found" inside the site chrome: a correct status and a dead end. It
  names the docs index and the three machine-readable indexes by full URL, so something that
  guessed a path wrong can recover instead of concluding the site is empty.

  The homepage carries JSON-LD. `SoftwareApplication` rather than `Organization`, because an
  Organization block is worth nothing without `contactPoint` and `address`, and there is no company
  here to describe.

  `GET /health/providers` and `GET /health/cooldowns` declared a 200 with no body schema, so a
  generated client got `unknown` from the two calls it makes on a schedule. Both are typed from a
  running container, and `docs:check` fails any operation whose 200 is untyped. The spec also now
  states what is safe to depend on: `X-Outcome-Class` is closed, `X-Outcome` is not, and at 0.x a
  breaking change to `/v1` arrives as a minor.

- [#200](https://github.com/proxlane/proxlane/pull/200) [`4ced601`](https://github.com/proxlane/proxlane/commit/4ced601885c80931630e9734d6d55fc0556209d9) Thanks [@scarsam](https://github.com/scarsam)! - The homepage caption above the provider table said one provider was "limited to seven regions"
  while the table one line below it rendered "42 codes". The table had already been fixed by
  deriving it from the capability registry; the sentence introducing the table was not, so the
  correction landed on the data and left the prose summarising it. It is computed from the same
  array now.

  The deploy paragraph is one line instead of four. The prices are on the buttons, so restating
  them underneath was reading the reader had already done.

- [#205](https://github.com/proxlane/proxlane/pull/205) [`7c7ebdd`](https://github.com/proxlane/proxlane/commit/7c7ebdd8d641a86c08e485ad29a0631ce0f061ee) Thanks [@scarsam](https://github.com/scarsam)! - Markdown negotiation returned 500 in production. The middleware answered by fetching the page's
  `.md` twin from its own origin, which works under `vite preview` and does not work from a
  Cloudflare Worker: the subrequest never reaches the asset layer, so it fell through to Start's
  router, and Start answers a non-HTML `Accept` with `500 Only HTML requests are supported here`.

  The markdown is inlined at build time now, from the same generated artifacts `/docs/<slug>.md`
  serves, so the two routes cannot drift. A page with no published twin answers 406 rather than
  falling through, because falling through is what produced the 500.

  Verified under `wrangler dev`, which runs workerd, rather than under the preview server that
  missed it the first time.

- [#201](https://github.com/proxlane/proxlane/pull/201) [`b6995dd`](https://github.com/proxlane/proxlane/commit/b6995dd7ca28978c9b98e52cd172dd423a0b427e) Thanks [@scarsam](https://github.com/scarsam)! - The Quickstart now starts a gateway before telling you to call one. "Get started" is the site's
  primary call to action and it lands here; the page opened by asking the reader to curl
  `https://your-gateway/…`, a placeholder that resolves to nothing, and only explained how to have
  a gateway eighty lines further down. It never mentioned `localhost` at all, so the address you
  would actually call appeared nowhere on the page. Order is now: start it, call it, migrate, move
  the key out of the query string.

  `proxlane doctor` fails when no provider key is set. Each per-key check stays green when absent,
  because BYOK means you bring the providers you use and flagging the three you do not have trains
  people to skip the output. Applied to _every_ key, that produced "13 checks, all good" for a
  gateway that cannot route one request. Zero keys is a different condition from one missing key,
  and now it has its own check with a fix line.

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

- Updated dependencies [[`71a0421`](https://github.com/proxlane/proxlane/commit/71a042118619c7e1d4809fc1571bd4cb8b5c6022), [`f26dbc3`](https://github.com/proxlane/proxlane/commit/f26dbc3e875e371e68f3c639789b9dcfc18aebc6)]:
  - @proxlane/adapters@0.7.2
  - @proxlane/ui@0.2.3

## 0.7.2

### Patch Changes

- Updated dependencies [[`3302c1c`](https://github.com/proxlane/proxlane/commit/3302c1c4ce77e02926a5f50404db44f1c00a0421)]:
  - @proxlane/shared@0.8.0
  - @proxlane/adapters@0.7.1

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

- [#185](https://github.com/proxlane/proxlane/pull/185) [`567c675`](https://github.com/proxlane/proxlane/commit/567c67596c61fecde0bb563f96337211f5c3b53e) Thanks [@scarsam](https://github.com/scarsam)! - The homepage's one copyable command pointed at a hostname that returns 401 to a service nobody can
  sign up for. It now shows `localhost:8787`, which is what the README has always said. The detection
  section no longer claims every competitor reports a block page as a success — that is false of a
  provider we ship an adapter for, and `plan.md` had already retracted it once.

- [#174](https://github.com/proxlane/proxlane/pull/174) [`37783d3`](https://github.com/proxlane/proxlane/commit/37783d37d07870d226a04b2fba4d64c21c31499d) Thanks [@scarsam](https://github.com/scarsam)! - Name Bright Data everywhere the site describes what the gateway routes across. Four surfaces
  still said three providers: the OpenAPI summary, the docs quickstart, the meta description and
  the docs index.
- Updated dependencies [[`7d5c835`](https://github.com/proxlane/proxlane/commit/7d5c83592cfcc40281fdb9d465f020f922083282), [`7e77a6d`](https://github.com/proxlane/proxlane/commit/7e77a6d09b470c77cdec25ff205d64f4bf930fb5), [`84e83ce`](https://github.com/proxlane/proxlane/commit/84e83cecd0218db1ffce4c75c7e22d7a6f8e3df4), [`8c05ff9`](https://github.com/proxlane/proxlane/commit/8c05ff918d74b70b6bff758469daaad906a08b80), [`4468690`](https://github.com/proxlane/proxlane/commit/4468690161f5e5c2b1f87d3839854d0f2849b07c), [`1248872`](https://github.com/proxlane/proxlane/commit/12488726f08b9e2dc0c047a56d56a4d926ac9625), [`292e67b`](https://github.com/proxlane/proxlane/commit/292e67b7fc1ec912a64910b88ae503e9b3180774), [`bb6348d`](https://github.com/proxlane/proxlane/commit/bb6348d23895edbf5efd2a21419d852980679205), [`df7a4c0`](https://github.com/proxlane/proxlane/commit/df7a4c0ba816b444c970433ab0625147714ae81b)]:
  - @proxlane/adapters@0.7.0
  - @proxlane/detect@0.3.0
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
