# State

Printed at session start by `.claude/hooks/session-start.sh`. **Under 50 lines**, and
**updated in the same commit as the work** — an interrupted session never reaches "the
end", and a confidently stale file is worse than an empty one.

Only what no command can answer: what is built is `pnpm repo:check`, what changed is
`git log`. No decisions log — a decision goes in the doc it changes, in the same commit.

## Now

Phase 1's definition of done is met: `conformance` and `selfhost:smoke` both green — a
clean `docker compose up` serves in ~30s against a five-minute claim. Next: `/detect`, the
last outcome with no owner; it needs real block pages, which cannot be summoned on demand.

## Blocked on

Owner decisions and external answers. None is unblocked by writing code.

- **The probe credential** — recovery from `demoted` is a background probe, but launch is
  BYOK and the gateway holds no house keys, so a demoted provider can never recover.
  Opted-in org key, or a shadow attempt billed to nobody? *Before the health machine.*
- **`domain-class`** — undefined anywhere, yet the per-class health key carries the block
  signal. Define it, or phase-gate it and route blocks to `cd:blk`.
- **Going public** — irreversible. Remaining: content triage (`affiliate-emails.md` and
  `docs/archive/**` leave), a history rewrite, Discussions, and a non-personal contact
  address. README licence and npm names are done; all five publish at 0.0.1.
  **CODE_OF_CONDUCT.md is blocked on that address** — a CoC whose report channel does not
  work promises a process that does not exist.
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
- **Health attribution: per-outcome, or per-(provider, outcome)?** `PROVIDER_ERROR` feeds
  global health and `TARGET_ERROR` does not, so the answer decides whether one dead target
  can demote a healthy provider for every org. All three providers CAN distinguish it —
  the earlier claim that ScraperAPI could not was wrong, see `integrations.md` §3. Also
  unresolved: a *target* 403/429 has no outcome. *Before the health machine.*
- **Comparative content vs affiliate terms** — `affiliate-emails.md` Q3. Two launch
  providers must confirm in writing. *External.*
- **Credits refundability** — `operations.md` §4. Confirm with the accountant before the
  ledger exists. *External.*
