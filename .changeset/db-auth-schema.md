---
"@proxlane/db": minor
---

The Better Auth schema, generated from `src/auth.ts` rather than hand-written, with migrations and an up/down round-trip tested against a real Postgres 17. Timestamps are `timestamptz`, correcting Better Auth's Drizzle codegen to match its own Kysely migrator.
