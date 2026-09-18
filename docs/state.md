# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and **updated in
the same commit as the work** — an interrupted session never reaches "the end", and a confidently
stale file is worse than an empty one. Only what no command can answer: what is built is
`pnpm repo:check`, what changed is `git log`. A decision goes in the doc it changes.

## Now

**LAUNCH, so far**: Show HN flagged within the hour, mods silent. Reddit megathreads 09-09, five
days on: zero engagement, zero referrals (r/selfhosted standalone post allowed from **11-10**).
Directory PRs open, unanswered: lorien/awesome-web-scraping #294, Germey/AwesomeWebScraping #20;
awesome-selfhosted from **12-12**. First migration page live 09-14. **55 views, 24 uniques, 4 stars.**
**Outreach from 09-18**: six emails to maintainers with provider code in public repos. Sandbox (#325) is the keyless first minute.

**Public since 2026-08-10**, ruleset on `main`. Dogfooding it against another of the maintainer's
projects found six defects in five days. That is not §9's "one stranger runs it", which stays open
and is still the item every question here waits on. **Health is off unless `PROXLANE_HEALTH=on`.**

**The canary gate CLOSED on 2026-08-31** (08-17, 08-24, 08-31; the third ~7h late, which is why
the gate counts *scheduled* runs, not Mondays). **All four keys in CI since 09-02**; a spent plan
reads UNCHECKED, not red. Free tiers are ~1,000 credits, one recording session from blocked. *Yours.*

## Blocked on

Owner decisions and external answers. None is unblocked by writing code.
- **Capabilities the providers tier-gate, and one set cannot say so** — countries (ScraperAPI
  `us`/`eu` on Hobby vs 79 on Business; ScrapingBee 42 vs 243) and `sessionId` + residential, which
  no provider sells. BYOK means the plan is the caller's, so `all` over-claims and any finite set
  breaks someone. *platform's and adapter's.*
- **Secret scanning depth** — non-provider patterns need paid Secret Protection. Core scanning is on.
- **Where `k6:soak` runs** — harness green, venue undecided. Gateway-internal time includes
  event-loop starvation, so a p95 on the shared box measures the neighbours.
- **Hosted credit margin** — `plan.md` §7: the dominant unbilled spend is provider-billed non-`OK`
  outcomes, above all `TARGET_NOT_FOUND`, so it is *which outcomes the caller pays for*, not only
  the rate. Weeks of traffic decide it. Phase 3.
- **All 6 detect rules are confirmed by a real capture.** Corpus is the private `proxlane/corpus`
  repo; clone it, point `PROXLANE_PRIVATE_CORPUS` at it. `operations.md` 8b has the 08-31 story.
- **Provider permission, in writing** — `plan.md` §18; `_dev/jina-reader` stays out of `REGISTRY`.
  **Bright Data 09-01: BYOK is not reselling, but pooling users behind one account or selling access
  as a product needs written approval** — naming hosted credits, not just keyless. **ScrapingBee is
  ambiguous, not a yes**: their AI cited non-transferable terms and declined, a human said it should
  be fine if nothing is stored. Scrapfly closed email 08-29, ScraperAPI silent. *External.*
- **Provider money: decided 09-17**, `plan.md` §14. Referral links only where there is no key,
  all four listed alphabetically; no testing credits, no preview. Applied 09-17: ScraperAPI
  approved, ScrapingBee and Bright Data pending, Scrapfly asked (no public program). Nothing is
  built until the docs page is. Replied to Bright Data 09-17: credits declined, config-only check
  offered to all four, pooling re-asked. *External.*
- **Credits refundability** — `operations.md` §4. Ask the accountant before the ledger exists.
