# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and
**updated in the same commit as the work** — an interrupted session never reaches "the
end", and a confidently stale file is worse than an empty one.

Only what no command can answer: what is built is `pnpm repo:check`, what changed is
`git log`. No decisions log — a decision goes in the doc it changes, in the same commit.

## Now

**Public since 2026-08-10**, with a ruleset on `main` carrying no bypass actor.

Health and cooldowns both route live traffic. Health re-ranks the chain and forces the
least-bad provider rather than refusing; cooldowns skip one that just refused this domain,
half-open with a claimed probe, and return `Retry-After` when everything is cooling. Both
in-process — `PROXLANE_REPLICAS>1` refuses to boot. Next: **Valkey backing** for both, and
the **probe worker**, which needs `apps/worker`.

The detector's rules come from vendor signatures and have **never seen a real block page**;
a test asserts the count.

## Blocked on

Owner decisions and external answers. None is unblocked by writing code.

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
