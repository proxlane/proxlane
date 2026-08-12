// Every table drizzle-kit should see.
//
// Better Auth's tables are GENERATED, never hand-written — it owns `user`, `session`,
// `account` and `verification`, and its organization plugin owns `organization`, `member` and
// `invitation`. Writing an `orgs` table beside them is a collision rather than a sequencing
// problem. See `operations.md` section 5.
//
// `log.ts` is deliberately ABSENT. `requests` and `request_attempts` are partitioned, and
// drizzle-kit would generate them unpartitioned — a table that looks right, holds data, and
// cannot be partitioned afterwards without a rewrite.
export * from './auth.js';
export * from './tables.js';
