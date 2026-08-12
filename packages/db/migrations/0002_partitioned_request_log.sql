-- The request log. HAND-WRITTEN, outside the drizzle-kit diff.
--
-- `plan.md` section 3: drizzle-orm is pre-1.0 and cannot express `PARTITION BY RANGE`. A table
-- declared in the drizzle schema would be generated unpartitioned — a table that looks correct,
-- accepts data, and cannot be partitioned afterwards without rewriting it. So these two live
-- here, and `src/schema/log.ts` carries matching definitions for query typing only.
--
-- WEEKLY, not monthly. Retention is 30 days for BYOK free and 90 for hosted
-- (`operations.md` section 3), and neither window can align with a month boundary. Retention
-- DETACHES AND DROPS whole partitions; it never issues a `DELETE` over a partitioned table,
-- which is what the retention job used to say and which defeats the point of partitioning.
--
-- The primary key must contain the partition key — Postgres requires it, because a unique
-- index cannot be enforced across partitions otherwise. Hence `(id, created_at)` rather than
-- `(id)`, even though `id` is a uuidv7 and unique on its own.

CREATE TABLE "requests" (
	-- uuidv7, minted by the gateway. Time-ordered, so inserts land at the end of the index
	-- rather than scattering across it, and this is the same value returned as X-Request-Id.
	"id" text NOT NULL,
	"org_id" text NOT NULL,
	-- Registrable domain plus a hash. NEVER the full URL by default: `operations.md` section 3
	-- makes that a privacy posture and a selling point, and it means a database leak does not
	-- reveal what customers scrape. Full-URL logging is per-org opt-in.
	"domain" text NOT NULL,
	"url_hash" text NOT NULL,
	-- The open member of the taxonomy. TEXT, never an enum: the union grew after launch and
	-- will keep growing as adapters land, and enum values can be added but never removed.
	"outcome" text NOT NULL,
	-- The CLOSED half. Cheap to index and safe to group by, because it does not grow.
	"outcome_class" text NOT NULL,
	"provider_used" text,
	"attempts" smallint NOT NULL DEFAULT 0,
	"total_latency_ms" integer,
	-- USD micros, normalised at ingestion. Integer, never float.
	"cost_micro_total" bigint NOT NULL DEFAULT 0,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "requests_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

CREATE INDEX "requests_org_created_idx" ON "requests" ("org_id", "created_at" DESC);
CREATE INDEX "requests_domain_idx" ON "requests" ("domain", "created_at" DESC);

-- One row per PROVIDER ATTEMPT, which is the logged grain.
--
-- A `requests` row records only the winner, so a losing provider's block on a domain is
-- invisible in it — and that dataset is what the scoreboard, the /targets pages and cost
-- routing are built from. `data-engineer.md` states this as a rule.
CREATE TABLE "request_attempts" (
	"request_id" text NOT NULL,
	"seq" smallint NOT NULL,
	"provider" text NOT NULL,
	"outcome" text NOT NULL,
	"outcome_class" text NOT NULL,
	"detect_rule" text,
	"upstream_status" smallint,
	"latency_ms" integer,
	"cost_micro" bigint NOT NULL DEFAULT 0,
	-- Whether the price came from the provider's own headers or from our cost table. Without
	-- it, a cost table that drifts is indistinguishable from a provider changing its prices.
	"cost_source" text NOT NULL DEFAULT 'table',
	"started_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "request_attempts_pkey" PRIMARY KEY ("request_id", "seq", "started_at")
) PARTITION BY RANGE ("started_at");

CREATE INDEX "request_attempts_provider_idx" ON "request_attempts" ("provider", "started_at" DESC);
CREATE INDEX "request_attempts_request_idx" ON "request_attempts" ("request_id");

-- NO FOREIGN KEY from request_attempts to requests, deliberately.
--
-- Postgres can reference a partitioned table, but only through a unique constraint that
-- includes the partition key — so the child would have to carry `request_created_at` as well,
-- and the constraint would then block dropping a `requests` partition while any attempts
-- partition still referenced it. Retention drops both, and an ordering dependency between two
-- detach-and-drop jobs is a worse failure than a soft reference: the job that runs second
-- fails, and the disk does not come back.
--
-- `plan.md` already takes this position for ledger entries, which keep `request_id` as a soft
-- reference precisely so retention can never orphan a row that must not be deleted.
