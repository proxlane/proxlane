# @proxlane/db

## 0.1.1

### Patch Changes

- [#117](https://github.com/proxlane/proxlane/pull/117) [`27f060d`](https://github.com/proxlane/proxlane/commit/27f060d4e913dd1ede38f88ea57dc5a6c57285de) Thanks [@scarsam](https://github.com/scarsam)! - The migration suite waits for Postgres to be ready rather than merely listening. It started the
  container with no wait strategy, so the default returned as soon as the port bound — before
  `initdb` finished — and all 17 partition tests failed at once with `57P03: the database system is
starting up`.

## 0.1.0

### Minor Changes

- fbe56bf: The Better Auth schema, generated from `src/auth.ts` rather than hand-written, with migrations and an up/down round-trip tested against a real Postgres 17. Timestamps are `timestamptz`, correcting Better Auth's Drizzle codegen to match its own Kysely migrator.
- 474c208: The hand-written schema: `gateway_keys` (with `created_by`), `provider_keys`, `domain_stats`, and the weekly-partitioned `requests` and `request_attempts` in raw SQL. Adds partition rotation and detach-and-drop retention, both idempotent.
