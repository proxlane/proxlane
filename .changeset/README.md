# Changesets

A behaviour change carries a changeset. One sentence, user-facing — what someone installing
the package would notice, not what the diff did.

```bash
pnpm changeset
```

CI blocks a PR that touches `apps/` or `packages/` without one. Docs-only and CI-only
changes need none.

Versions are **independent**: `fixed: []`. Fixed versioning would major every package
whenever one broke, which is a cost `integrations.md` already accepts for adapters sharing
a version and explicitly does not want to spread further.
