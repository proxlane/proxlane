// Single source of truth for container image tags.
//
// docker/compose.dev.yml must use these exact tags and repo:check asserts it, because
// "testcontainers versions matching the compose file" is otherwise a habit rather than a
// check — and a drifted Postgres major between dev and test is the kind of thing that only
// shows up in a migration.
//
// pgvector/pgvector:pg17 rather than postgres:17 on purpose: the image is already resident
// on the deployment box, so reusing it costs no additional disk. another project on the same box needs the
// vector extension; we do not yet, but sharing the image is free and diverging is not.

export const POSTGRES_IMAGE = 'pgvector/pgvector:pg17';
export const VALKEY_IMAGE = 'valkey/valkey:8-alpine';
