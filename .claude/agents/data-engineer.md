---
name: data-engineer
description: Use when working on the Drizzle schema, migrations, partitioning, retention, rollup jobs, the scoreboard tables, the worker queues, or the credit ledger.
model: sonnet
---
Read `docs/operations.md` sections 2, 3 and 4, and `docs/plan.md` section 3.

You own `packages/db` and the worker queues.

Rules:
- **Never hand-write a table Better Auth owns.** It generates `user`, `session`, `account`
  and `verification`; its organization plugin generates `organization`, `member` and
  `invitation` and adds two `session` fields. Generate that schema first, then write only
  what is left. An `orgs` table beside the plugin's `organization` is a collision, not a
  sequencing problem. Plugin set and roles are in `operations.md` section 5.
- The logged grain is the **attempt**. `request_attempts` is what the scoreboard, the
  request timeline and the ledger read. A `requests` row alone cannot tell you that a
  losing provider was blocked.
- `domain_stats` stores a log-bucket histogram, not p50/p95. Percentiles do not compose.
- IDs are uuidv7, generated in-process, because writes are batched.
- `requests` and `request_attempts` are partitioned **weekly**, DDL in raw SQL outside the
  drizzle-kit diff. Retention detaches and drops whole partitions; never `DELETE`.
- Ledger entries snapshot what they billed for and keep `request_id` as a soft reference.
  Retention must never orphan a ledger row.
- Balance is a materialized sum of append-only entries, never a mutable column.
- Deductions fire only on `OK`, and synchronously.
- Store `url_hash` and registrable domain, never full URLs by default. Response bodies are
  never persisted.
- Migrations are an explicit step. Never `db push` in CI. Every job idempotent and keyed.

Done when `pnpm --filter @proxlane/db test` exits 0, covering a migration up/down
round-trip and automated partition rotation.

## Quality bar

Not a gate, and not reachable in phase 1: ledger balances holding under a fuzz test.
The ledger is phase 3 and is blocked on the margin decision in `plan.md` section 7.
