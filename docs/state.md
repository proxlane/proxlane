# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and
**updated in the same commit as the work** — an interrupted session never reaches "the
end", and a confidently stale file is worse than an empty one.

Only what no command can answer: what is built is `pnpm repo:check`, what changed is
`git log`. No decisions log — a decision goes in the doc it changes, in the same commit.

## Now

**Public since 2026-08-10**, ruleset on `main` with no bypass actor. **It serves production
traffic now**, and that traffic is where health calibration and the credit-rate question both
get their evidence. First real failover 2026-08-20: four timeouts, all four served by the next
provider, no caller saw an error.

Cooldowns route it. **Health is off unless `PROXLANE_HEALTH=on`**: calibration assumes independent
failures and real providers have bad hours. **5 of 6 detect rules are confirmed** by a real
capture; five of the six had a defect only a real page could show.

**The canary gate is 1 of 3.** §9 wants three consecutive *scheduled* greens; the first landed
**2026-08-17** and cron is Mondays, so it clears **2026-08-31**. Count scheduled runs only.

## Blocked on

Owner decisions and external answers. None is unblocked by writing code.
- **Countries are tier-gated and one set cannot say so** — ScraperAPI sells `us`/`eu` on Hobby and
  79 codes on Business; ScrapingBee 42 on classic and 243 on premium. BYOK means the plan is the
  caller's, so `all` over-claims and any finite set breaks someone. Needs a tier-keyed set. Also
  open: `zz` buys a paid attempt everywhere, and nobody has checked whether a bad code errors or
  silently serves elsewhere. *platform's.*
- **Sessions are wired on one adapter** — so `sessionId` + residential has no provider: ScraperAPI
  is the only one and it refuses that pair. ScrapingBee (`session_id`) and Scrapfly (`session`)
  support sessions and neither forbids it. Same shape POST had. *adapter-engineer's.*
- **Secret scanning depth** — core scanning and push protection are on. Non-provider patterns and
  validity checks need paid Secret Protection: buy it, or accept a bespoke key shape unscanned.
- **Where `k6:soak` runs** — harness green, venue undecided. Gateway-internal time includes
  event-loop starvation, so a p95 on the shared box measures the neighbours. *Before it is a gate.*
- **Hosted credit margin** — `plan.md` §7, and it changed shape: the dominant unbilled spend is
  provider-billed non-`OK` outcomes, above all `TARGET_NOT_FOUND`, not failover — so it is *which
  outcomes the caller pays for*, not only the rate. Weeks of real traffic decide it. Phase 3.
- **The last detect rule** — `proxlane/corpus` (private) holds the captures; `capture-block` puts
  them there, `corpus:verify` regenerates the claim. `imperva-incapsula` is safe but unconfirmed.
- **Provider permission, in writing** — `plan.md` §18 gates the keyless paths (`npx proxlane try`,
  the blocked-domain checker, the playground, a free fallback) on permission and Swedish counsel;
  `_dev/jina-reader` stays out of `REGISTRY` meanwhile. `affiliate-emails.md` Q3 separately needs
  two launch providers to confirm comparative content is allowed. *External.*
- **Credits refundability** — `operations.md` §4. Confirm with the accountant before the
  ledger exists. *External.*
