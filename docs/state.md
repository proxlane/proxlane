# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and **updated in
the same commit as the work** — an interrupted session never reaches "the end", and a confidently
stale file is worse than an empty one. Only what no command can answer: what is built is
`pnpm repo:check`, what changed is `git log`. A decision goes in the doc it changes.

## Now

**LAUNCH: week of 2026-08-31**, when the canary clears. Show HN, r/webscraping, r/selfhosted.
**54 views, 5 uniques, 14 days, against 184 PRs** — the bottleneck is distribution, not quality.

**Public since 2026-08-10**, ruleset on `main` with no bypass actor. **It serves production
traffic**, which is where health calibration and the credit-rate question get their evidence.
**Health is off unless `PROXLANE_HEALTH=on`** — calibration assumes independent failures and real
providers have bad hours. **5 of 6 detect rules confirmed** by a real capture.

**The canary gate is 2 of 3**, counting the `test:live` step and not the daily scheduled jobs:
**2026-08-17** and **2026-08-24** ran green. Cron is Mondays, so the third is launch week itself —
and it measures two of four providers unless the credits below are topped up first.

## Blocked on

Owner decisions and external answers. None is unblocked by writing code.
- **Capabilities the providers tier-gate, and one set cannot say so** — countries (ScraperAPI
  `us`/`eu` on Hobby vs 79 on Business; ScrapingBee 42 vs 243) and `sessionId` + residential, which
  no provider sells. BYOK means the plan is the caller's, so `all` over-claims and any finite set
  breaks someone. *platform's and adapter's.*
- **`BRIGHTDATA_KEY` is not a repository secret**, so the canary and `record --diff` skip Bright
  Data weekly and warn. **Safe to set now** — before 2026-08-29 it would have gone red on a healthy
  provider: the canary hand-rolled a `fetch` that dropped `wire.body`, and Bright Data alone POSTs
  one. Only you can set it.
- **Secret scanning depth** — non-provider patterns need paid Secret Protection: buy it, or accept
  a bespoke key shape unscanned. Core scanning is on.
- **Where `k6:soak` runs** — harness green, venue undecided. Gateway-internal time includes
  event-loop starvation, so a p95 on the shared box measures the neighbours.
- **Hosted credit margin** — `plan.md` §7: the dominant unbilled spend is provider-billed non-`OK`
  outcomes, above all `TARGET_NOT_FOUND`, so it is *which outcomes the caller pays for*, not only
  the rate. Weeks of traffic decide it. Phase 3.
- **The last detect rule** — `imperva-incapsula` unconfirmed; `corpus:verify` regenerates it.
- **Provider permission, in writing** — `plan.md` §18 gates the keyless paths on it;
  `_dev/jina-reader` stays out of `REGISTRY` meanwhile. Batch 1 sent: ScrapingBee yes if the
  methodology is public and asked a question back, Bright Data escalated to Compliance, Scrapfly
  closed without answering, ScraperAPI silent. *External.*
- **Provider credits** — ScraperAPI and Scrapfly are both at zero until 2026-09-07, exhausted
  recording fixtures on 2026-08-27. Until they are topped up the Monday canary measures two of
  four providers, `pnpm record` cannot run, and the deferred Scrapfly `large-object` fixture stays
  owed. *Yours, and it gates the launch gate.*
- **Credits refundability** — `operations.md` §4. Ask the accountant before the ledger exists.
