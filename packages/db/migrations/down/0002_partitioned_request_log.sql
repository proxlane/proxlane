-- Down for 0002.
--
-- Dropping a partitioned parent drops its partitions with it, which is the one place that is
-- correct rather than dangerous: a partition of this table cannot belong to anything else.
DROP TABLE IF EXISTS "request_attempts";
DROP TABLE IF EXISTS "requests";
