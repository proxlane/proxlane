# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and
**updated in the same commit as the work** — an interrupted session never reaches "the
end", and a confidently stale file is worse than an empty one.

Only what no command can answer: what is built is `pnpm repo:check`, what changed is
`git log`. No decisions log — a decision goes in the doc it changes, in the same commit.

## Now

**Public since 2026-08-10**, ruleset on `main` with no bypass actor. **It serves production
traffic now**, and that traffic is where health calibration and the credit-rate question both
get their evidence. First real failover 2026-08-20: four ScraperAPI timeouts, all four served
by the next provider, no caller saw an error.

Cooldowns route it. **Health is off unless `PROXLANE_HEALTH=on`**: calibration assumes
independent failures and real providers have bad hours. The detector has **never seen a real
block page**; a test asserts the count.

**The canary gate is 1 of 3.** §9 wants three consecutive *scheduled* greens; the first landed
**2026-08-17** and cron is Mondays, so it clears **2026-08-31**. Count scheduled runs only.

## Blocked on

Owner decisions and external answers. None is unblocked by writing code.
- **A country nobody can serve** — `country_code=zz` buys a paid attempt at every provider, each
  answering `PROVIDER_ERROR`, so a caller's typo degrades shared provider health. No outcome fits:
  failover true, cooldown none, health excluded. `countryCodes: 'all'` is why capability filtering
  misses it. A taxonomy member, or real country lists. *platform-engineer's; adapters must not.*
- **Secret scanning depth** — core scanning and push protection are on. Non-provider patterns
  and validity checks need paid Secret Protection: buy it, or accept a bespoke key shape unscanned.
- **Where `k6:soak` runs** — harness green, venue undecided. Gateway-internal time excludes
  network but includes event-loop starvation, so a p95 on the shared box measures the neighbours.
  Dedicated ephemeral box, or restate the threshold honestly. *Before it is a launch gate.*
- **Hosted credit margin** — `plan.md` §7, and it changed shape: the dominant unbilled spend is
  provider-billed non-`OK` outcomes, above all `TARGET_NOT_FOUND`, not failover. So it is *which
  outcomes the caller pays for*, not only the rate. `X-Chain` logs `provider:outcome` per attempt,
  so decide on weeks of real traffic. Blocks the ledger and Stripe. Phase 3; figures are private.
- **A private fixture corpus** — `plan.md` §19 bars recording any named commercial target here,
  and the private half holding block and captcha fixtures does not exist. Unowned build.
- **Keyless paths and provider ToS** — `plan.md` §18. Needs provider permission in writing and
  Swedish counsel. `npx proxlane try`, the blocked-domain checker, the playground and a **free
  fallback** stay unbuilt; `_dev/jina-reader` stays out of `REGISTRY`. `/docs/adapters` ships
  the custom-adapter story instead, which needs nobody's permission.
- **Comparative content vs affiliate terms** — `affiliate-emails.md` Q3. Two launch
  providers must confirm in writing. *External.*
- **Credits refundability** — `operations.md` §4. Confirm with the accountant before the
  ledger exists. *External.*
