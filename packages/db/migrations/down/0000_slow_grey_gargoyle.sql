-- Down for 0000: the Better Auth core tables plus the organization and twoFactor plugins.
--
-- Hand-written, because drizzle-kit generates forward-only SQL and has no `down`. That is a
-- real gap for an operator: without this, a bad migration in production can only be undone by
-- restoring a backup. `operations.md` section 3 makes migrations an explicit step precisely so
-- that they are reviewable and reversible.
--
-- Order is children before parents. `CASCADE` is deliberately NOT used: it would silently drop
-- objects a later migration added that this one knows nothing about, which is the difference
-- between a rollback and a data-loss incident. If a drop fails on a dependency, that is the
-- correct outcome and the dependency needs its own down migration first.

DROP TABLE IF EXISTS "invitation";
DROP TABLE IF EXISTS "member";
DROP TABLE IF EXISTS "two_factor";
DROP TABLE IF EXISTS "session";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "organization";
DROP TABLE IF EXISTS "user";
