-- Down for 0001: the hand-written tables Better Auth does not own.
--
-- Children before parents; no CASCADE, so a dependency added by a later migration fails the
-- rollback loudly instead of being silently destroyed by it.
DROP TABLE IF EXISTS "domain_stats";
DROP TABLE IF EXISTS "provider_keys";
DROP TABLE IF EXISTS "gateway_keys";
