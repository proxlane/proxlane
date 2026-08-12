# @proxlane/db

## 0.1.0

### Minor Changes

- fbe56bf: The Better Auth schema, generated from `src/auth.ts` rather than hand-written, with migrations and an up/down round-trip tested against a real Postgres 17. Timestamps are `timestamptz`, correcting Better Auth's Drizzle codegen to match its own Kysely migrator.
- 474c208: The hand-written schema: `gateway_keys` (with `created_by`), `provider_keys`, `domain_stats`, and the weekly-partitioned `requests` and `request_attempts` in raw SQL. Adds partition rotation and detach-and-drop retention, both idempotent.
