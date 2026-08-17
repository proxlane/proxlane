# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and
**updated in the same commit as the work** — an interrupted session never reaches "the
end", and a confidently stale file is worse than an empty one.

Only what no command can answer: what is built is `pnpm repo:check`, what changed is
`git log`. No decisions log — a decision goes in the doc it changes, in the same commit.

## Now

**Public since 2026-08-10**, with a ruleset on `main` carrying no bypass actor.

Cooldowns route live traffic. **Health is off unless `PROXLANE_HEALTH=on`**: its calibration
assumes independent failures and real providers have bad hours, so validating it needs real
traffic. The detector's rules come from vendor signatures and have **never seen a real block
page**; a test asserts the count.

**The canary gate is 1 of 3.** §9 wants three consecutive *scheduled* greens; the first landed
**2026-08-17** and cron is Mondays, so it clears **2026-08-31**. Count scheduled runs only.

## Blocked on

Owner decisions and external answers. None is unblocked by writing code.
- **A country nobody can serve** — `country_code=zz` buys a paid attempt at every provider, each
  answering `PROVIDER_ERROR`, so a caller's bad parameter degrades shared provider health. No
  outcome fits: it needs failover true, cooldown none, health excluded. `countryCodes: 'all'` is
  why capability filtering misses it. A taxonomy member, or real per-provider country lists.
  *platform-engineer's call; an adapter must not invent it.*
- **Secret scanning depth** — core scanning and push protection are on. Non-provider
  patterns and validity checks accept a 200 from the API and stay disabled; they need
  paid Secret Protection. Buy it, or accept that a bespoke key shape goes unscanned.
- **Where `k6:soak` runs** — harness built and green, venue undecided. Gateway-internal time
  excludes network but includes event-loop starvation, so a p95 measured on the shared box
  measures the neighbours. Dedicated ephemeral box, or restate the threshold honestly.
  *Before it is a launch gate.*
- **Hosted credit margin** — `plan.md` §7. The rate does not clear its costs once failover
  attempts are counted. Blocks the ledger and all Stripe work. Phase 3; figures are private.
- **A private fixture corpus** — `plan.md` §19 bars recording any named commercial target
  into this repo, and the private half that would hold block and captcha fixtures does not
  exist. Unowned build.
- **Keyless paths and provider ToS** — `plan.md` §18. Needs provider permission in writing and
  Swedish counsel. `npx proxlane try`, the blocked-domain checker, the playground and a **free
  fallback** stay unbuilt; `_dev/jina-reader` stays out of `REGISTRY`. `/docs/adapters` ships
  the custom-adapter story instead, which needs nobody's permission.
- **Comparative content vs affiliate terms** — `affiliate-emails.md` Q3. Two launch
  providers must confirm in writing. *External.*
- **Credits refundability** — `operations.md` §4. Confirm with the accountant before the
  ledger exists. *External.*
