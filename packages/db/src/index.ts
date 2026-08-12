// `@proxlane/db` — the persistence layer.
//
// AGPL and `private: true`: it is imported by `apps/web` and the worker, never published, and
// never by `apps/gateway`, which must not touch Postgres on the hot path.
export * from './auth.js';
export * from './migrate.js';
export * as schema from './schema/index.js';
