# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and
**updated in the same commit as the work** — an interrupted session never reaches "the
end", and a confidently stale file is worse than an empty one.

Only what no command can answer: what is built is `pnpm repo:check`, what changed is
`git log`. No decisions log — a decision goes in the doc it changes, in the same commit.

## Now

**Public since 2026-08-10**, with a ruleset on `main` carrying no bypass actor.

Cooldowns route live traffic. **Health is off unless `PROXLANE_HEALTH=on`**: its calibration
assumes independent failures, and a two-regime provider with the same mean rate spends 93% of
its time demoted in simulation. Validating it needs real traffic. State is in-process or shared
via `PROXLANE_VALKEY_URL`; the prober lifts demoted providers back, and
`GET /health/cooldowns` shows what is cooling. The detector's rules come from vendor
signatures and have **never seen a real block page**; a test asserts the count.

**The canary gate has not started, though the run list reads as if it has.** §9 wants three
consecutive *scheduled* greens; the only canary green was a `workflow_dispatch`, and the other
scheduled greens are different jobs (`cost-drift`, `record:diff`). Cron is Mondays, so the
first real run is **2026-08-17** and the gate clears **2026-08-31**. Count scheduled runs only.

## Blocked on

Owner decisions and external answers. None is unblocked by writing code.

- **Secret scanning depth** — core scanning and push protection are on. Non-provider
  patterns and validity checks accept a 200 from the API and stay disabled; they need
  paid Secret Protection. Buy it, or accept that a bespoke key shape goes unscanned.
- **Where `k6:soak` runs** — the harness is built and green; only the venue is undecided.
  The box sits at ~66% CPU / ~51% IO pressure, and gateway-internal time excludes network but
  includes event-loop starvation, so a p95 measured there measures the neighbours. Provider
  variance is already gone: the soak runs against a local mock. Dedicated ephemeral box, or
  restate the threshold honestly. *Before it is a launch gate.*
- **Hosted credit margin** — `plan.md` §7. The rate does not clear its costs once failover
  attempts are counted. Blocks the ledger and all Stripe work. Phase 3; figures are private.
- **A private fixture corpus** — `plan.md` §19 bars recording any named commercial target
  into this repo, and the private half that would hold block and captcha fixtures does not
  exist. Unowned build.
- **Keyless paths and provider ToS** — `plan.md` §18. Needs provider permission in writing
  and Swedish counsel. *Interim default:* `npx proxlane try`, the blocked-domain checker
  and the playground are neither built nor documented as available.
- **Comparative content vs affiliate terms** — `affiliate-emails.md` Q3. Two launch
  providers must confirm in writing. *External.*
- **Credits refundability** — `operations.md` §4. Confirm with the accountant before the
  ledger exists. *External.*
