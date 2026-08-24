# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and
**updated in the same commit as the work** — an interrupted session never reaches "the
end", and a confidently stale file is worse than an empty one.

Only what no command can answer: what is built is `pnpm repo:check`, what changed is
`git log`. No decisions log — a decision goes in the doc it changes, in the same commit.

## Now

**LAUNCH: week of 2026-08-31**, when the canary clears. Show HN, r/webscraping, r/selfhosted.
**54 views, 5 uniques, 14 days, against 184 PRs** — the bottleneck is distribution, not quality.
§9 was re-scoped 2026-08-23: it gated on a backup drill and a status page for services
deliberately not built, so it could never close and the launch slipped weekly to work that ends
in a green check.

**Public since 2026-08-10**, ruleset on `main` with no bypass actor. **It serves production
traffic**, which is where health calibration and the credit-rate question get their evidence.
First real failover 2026-08-20: four timeouts, all served by the next provider, no caller saw an
error. Cooldowns route it. **Health is off unless `PROXLANE_HEALTH=on`** — calibration assumes
independent failures and real providers have bad hours. **5 of 6 detect rules confirmed** by a
real capture; five of the six had a defect only a real page could show.

**The canary gate is 2 of 3**, counting the `test:live` step and not the daily scheduled jobs:
**2026-08-17** and **2026-08-24** ran green. Cron is Mondays, so the third is launch week itself.

## Blocked on

Owner decisions and external answers. None is unblocked by writing code.
- **Countries are tier-gated and one set cannot say so** — ScraperAPI sells `us`/`eu` on Hobby, 79
  on Business; ScrapingBee 42 on classic, 243 on premium. BYOK means the plan is the caller's, so
  `all` over-claims and any finite set breaks someone. `zz` also unchecked. *platform's.*
- **Sessions are wired on one adapter** — `sessionId` + residential has no provider: ScraperAPI is
  the only one and refuses that pair. ScrapingBee and Scrapfly support sessions. *adapter's.*
- **`BRIGHTDATA_KEY` is not a repository secret**, so the canary and `record --diff` skip Bright
  Data weekly and warn. Assertion 41 covers the plumbing; only you can set the secret.
- **Secret scanning depth** — non-provider patterns and validity checks need paid Secret
  Protection: buy it, or accept a bespoke key shape unscanned. Core scanning is on.
- **Where `k6:soak` runs** — harness green, venue undecided. Gateway-internal time includes
  event-loop starvation, so a p95 on the shared box measures the neighbours. *Before it is a gate.*
- **Hosted credit margin** — `plan.md` §7, changed shape: the dominant unbilled spend is
  provider-billed non-`OK` outcomes, above all `TARGET_NOT_FOUND` — so it is *which outcomes the
  caller pays for*, not only the rate. Weeks of traffic decide it. Phase 3.
- **The last detect rule** — `imperva-incapsula` unconfirmed; `corpus:verify` regenerates it.
- **Provider permission, in writing** — `plan.md` §18 gates the keyless paths on permission and
  Swedish counsel; `_dev/jina-reader` stays out of `REGISTRY` meanwhile. `affiliate-emails.md` Q3
  needs two providers to allow comparative content. **The four emails are unsent.** *External.*
- **Credits refundability** — `operations.md` §4. Ask the accountant before the ledger exists.
