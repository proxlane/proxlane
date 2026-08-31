# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and **updated in
the same commit as the work** — an interrupted session never reaches "the end", and a confidently
stale file is worse than an empty one. Only what no command can answer: what is built is
`pnpm repo:check`, what changed is `git log`. A decision goes in the doc it changes.

## Now

**LAUNCH: week of 2026-08-31**, when the canary clears. Show HN, r/webscraping, r/selfhosted.
**54 views, 5 uniques, 14 days, against 184 PRs** — the bottleneck is distribution, not quality.

**Public since 2026-08-10**, ruleset on `main` with no bypass actor. It serves production traffic,
which in five days found six defects nothing else would have — see `operations.md` §9, where the
gate's own highest-value item is now ticked. **Health is off unless `PROXLANE_HEALTH=on`.**

**The canary gate is 2 of 3**: **2026-08-17** and **2026-08-24** green, cron Mondays 06:17 UTC.
It covers **Bright Data and ScrapingBee only** — `SCRAPERAPI_KEY` and `SCRAPFLY_KEY` are out of CI
until their free quotas renew 09-07, because a present-but-empty key makes the canary report a
healthy provider as failed. `operations.md` §9 records the coverage; re-add both on 09-07.
**A scheduled run can also simply not happen** — 08-31's was still absent 55 minutes past cron —
and a gate counting scheduled runs stalls rather than resets when GitHub is late.

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
- **The corpus lost five of its six captures.** `imperva-incapsula` IS now confirmed by a real
  capture (stored, scrubbed, 2026-08-29) but cannot enter the table: regenerating would retract
  four claims whose artefacts no longer exist anywhere, and #244 rightly refuses. Retract to what
  is provable and rebuild from live traffic, or leave five claims standing without evidence. *Yours.*
- **Provider permission, in writing** — `plan.md` §18 gates the keyless paths on it;
  `_dev/jina-reader` stays out of `REGISTRY` meanwhile. Batch 1 sent: ScrapingBee yes if the
  methodology is public and asked a question back, Bright Data escalated to Compliance, Scrapfly
  closed without answering, ScraperAPI silent. *External.*
- **Provider credits** — ScraperAPI and Scrapfly at zero until 2026-09-07, exhausted recording
  fixtures on 08-27. `pnpm record` cannot run and the deferred Scrapfly `large-object` fixture
  stays owed. All four adapters run on ~1,000-credit monthly free tiers, so the canary is
  permanently one recording session from being blocked. *Yours.*
- **Credits refundability** — `operations.md` §4. Ask the accountant before the ledger exists.
