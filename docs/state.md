# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and **updated in
the same commit as the work** — an interrupted session never reaches "the end", and a confidently
stale file is worse than an empty one. Only what no command can answer: what is built is
`pnpm repo:check`, what changed is `git log`. A decision goes in the doc it changes.

## Now

**LAUNCH attempted**: the Show HN was flagged within the hour and is still down, no reply from
the mods. r/webscraping and r/selfhosted are unspent. **54 views, 5 uniques, 14 days, against 184
PRs** — the bottleneck is distribution, and one flagged post did not change that.

**Public since 2026-08-10**, ruleset on `main`. Dogfooding it against another of the maintainer's
projects found six defects in five days. That is not §9's "one stranger runs it", which stays open
and is still the item every question here waits on. **Health is off unless `PROXLANE_HEALTH=on`.**

**The canary gate CLOSED on 2026-08-31**: three consecutive scheduled greens, 08-17, 08-24, 08-31.
The third arrived ~7h after its cron, which is why a gate counting *scheduled* runs stalls rather
than resets when GitHub is late. **All four keys back in CI since 09-02**: the canary reads
`RATE_LIMITED` and reports that provider UNCHECKED, so a spent plan needs no human to pull a secret.
Quotas renew 09-07 **21:13 UTC**, after that morning's cron — so all four are first covered 09-14.

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
- **All 6 detect rules are confirmed by a real capture.** The corpus is the private
  `proxlane/corpus` repo; clone it and point `PROXLANE_PRIVATE_CORPUS` at it. On 08-31 it was
  wrongly assumed lost and the table was published at 2 of 6 for about an hour — `operations.md`
  8b has the story and the guard that should have stopped it.
- **Provider permission, in writing** — `plan.md` §18; `_dev/jina-reader` stays out of `REGISTRY`.
  **Bright Data 2026-09-01: BYOK is not reselling, but pooling users behind one account or selling
  access as a product needs separate written approval** — that names hosted credits, not just the
  keyless paths. ScrapingBee yes-if-public and asked back, Scrapfly closed, ScraperAPI silent. *External.*
- **Provider credits** — ScraperAPI and Scrapfly at zero until 2026-09-07, exhausted recording
  fixtures on 08-27. `pnpm record` cannot run and the deferred Scrapfly `large-object` fixture
  stays owed. All four adapters run on ~1,000-credit monthly free tiers, so the canary is
  permanently one recording session from being blocked. *Yours.*
- **Credits refundability** — `operations.md` §4. Ask the accountant before the ledger exists.
