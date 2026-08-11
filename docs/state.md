# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and
**updated in the same commit as the work** — an interrupted session never reaches "the
end", and a confidently stale file is worse than an empty one.

Only what no command can answer: what is built is `pnpm repo:check`, what changed is
`git log`. No decisions log — a decision goes in the doc it changes, in the same commit.

## Now

**Public since 2026-08-10.** Ruleset on `main` with no bypass actor, verified by a rejected
push, so blocking CI binds on the maintainer too. Scanning and Dependabot are on.

Phase 1 done, all 16 outcomes have a producer. The detector's rules come from vendor
signatures and have **never seen a real block page**; a test asserts the count.

## Blocked on

Owner decisions and external answers. None is unblocked by writing code.

- **The probe credential** — the only thing between the health machine and working;
  `domain-class` is now phase-gated in `integrations.md` §3 and blocks route to `cd:blk`.
  Recovery from `demoted` is a background probe, but launch is BYOK and the gateway holds no
  house keys. An opted-in org's key, or a shadow attempt billed to nobody? The statistic,
  the store, routing and the surface are all buildable without an answer. Recovery is not.
- **Secret scanning depth** — core scanning and push protection are on. Non-provider
  patterns and validity checks accept a 200 from the API and stay disabled; they need
  paid Secret Protection. Buy it, or accept that a bespoke key shape goes unscanned.
- **Where `k6:soak` runs** — the box sits at ~66% CPU / ~51% IO pressure during normal
  scrape windows, so a gateway-internal p95 gate measured there measures the neighbours.
  Dedicated ephemeral box, or restate the threshold honestly. *Before it is a launch gate.*
- **Hosted credit margin** — `plan.md` §7. The rate does not clear its costs once failover
  attempts are counted. Blocks the ledger and all Stripe work. Phase 3; figures are private.
- **A private fixture corpus** — `plan.md` §19 bars recording any named commercial target
  into this repo, and the private half that would hold block and captcha fixtures does not
  exist. Unowned build.
- **Keyless paths and provider ToS** — `plan.md` §18. Needs provider permission in writing
  and Swedish counsel. *Interim default:* `npx proxlane try`, the blocked-domain checker
  and the playground are neither built nor documented as available.
- **A target 429 has no outcome of its own.** It falls to `TARGET_ERROR`, which carries no
  health weight and fails over once — probably right, but undecided rather than chosen. A
  target throttling us is a block signal, so `HARD_BLOCK` and the shared `cd:blk` cooldown
  is the other candidate. *(Attribution itself is settled: per-outcome, because every
  adapter discharges the provider-specific part in `parse`. `packages/shared/src/health.ts`.)*
- **Comparative content vs affiliate terms** — `affiliate-emails.md` Q3. Two launch
  providers must confirm in writing. *External.*
- **Credits refundability** — `operations.md` §4. Confirm with the accountant before the
  ledger exists. *External.*
