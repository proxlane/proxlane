// The hand-written half of the schema: everything Better Auth does not own.
//
// `requests` and `request_attempts` are NOT here. They are partitioned, drizzle-kit cannot
// express `PARTITION BY RANGE`, and a table defined here would be generated unpartitioned —
// silently, and irreversibly once it holds data. They live in `log.ts` for typing, with their
// DDL hand-written in raw SQL. See `plan.md` section 3.

import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';

/**
 * Keys callers present to the gateway.
 *
 * Hashed with argon2id and shown once, per `operations.md` section 5. The hash is what is
 * stored; there is no path back to the key, including for us.
 */
export const gatewayKeys = pgTable(
	'gateway_keys',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		/**
		 * Who minted it.
		 *
		 * The only route to per-member scoping of the request log later, because a request
		 * attributes to the org and the KEY, never to a user — the gateway does not know users
		 * exist. Adding it after `request_attempts` references keys would be a migration on a
		 * partitioned-adjacent table. One column now. See `operations.md` section 5.
		 *
		 * Nullable and `set null`: a key must outlive the member who created it, or removing
		 * someone from an org would revoke the credentials their scrapers run on.
		 */
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		keyHash: text('key_hash').notNull(),
		name: text('name').notNull(),
		/** `prod`, `staging`, whatever the operator wants. Scoping is theirs to define. */
		environment: text('environment').notNull().default('default'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		/** So an operator can spot a key nothing has used in months. Written out of band. */
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
	},
	(t) => [
		uniqueIndex('gateway_keys_hash_idx').on(t.keyHash),
		index('gateway_keys_org_idx').on(t.orgId),
	],
);

/**
 * A customer's provider credentials, sealed.
 *
 * `operations.md` section 5: libsodium sealed boxes are asymmetric, so `apps/web` holds the
 * public key and writes keys it cannot itself read. Nobody reads one back at any role — not
 * an admin, not the owner. Rotation replaces; it never reveals.
 */
export const providerKeys = pgTable(
	'provider_keys',
	{
		id: text('id').primaryKey(),
		orgId: text('org_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		/**
		 * Adapter id. TEXT, never a Postgres enum: adapters are the thing we most want written
		 * by strangers, and an enum makes every new one a migration whose values can be added
		 * but never removed or reordered.
		 */
		provider: text('provider').notNull(),
		ciphertext: text('ciphertext').notNull(),
		label: text('label'),
		/** `active` | `invalid` | `revoked`. Text for the same reason as `provider`. */
		status: text('status').notNull().default('active'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
	},
	(t) => [uniqueIndex('provider_keys_org_provider_idx').on(t.orgId, t.provider, t.label)],
);

/**
 * The rollup the scoreboard reads.
 *
 * A LOG-BUCKET HISTOGRAM, not p50/p95. Percentiles do not compose: you cannot average two
 * p95s, so storing them makes every aggregate across domains or windows wrong. Buckets add.
 */
export const domainStats = pgTable(
	'domain_stats',
	{
		domain: text('domain').notNull(),
		provider: text('provider').notNull(),
		windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
		/** Window length in seconds, so hourly and daily rollups share one table. */
		windowLen: integer('window_len').notNull(),
		successes: integer('successes').notNull().default(0),
		failures: integer('failures').notNull().default(0),
		/** Log-scale latency buckets. Counts, which sum across rows. */
		latencyHist: integer('latency_hist').array().notNull().default([]),
		/** USD micros. Integer, never float — money is not a binary fraction. */
		// `sql\`0\`` rather than `0n`: drizzle-kit JSON-serialises the schema snapshot and a
		// BigInt literal throws `Do not know how to serialize a BigInt` at generate time.
		costMicroSum: bigint('cost_micro_sum', { mode: 'bigint' }).notNull().default(sql`0`),
	},
	(t) => [
		uniqueIndex('domain_stats_key_idx').on(t.domain, t.provider, t.windowStart, t.windowLen),
		index('domain_stats_window_idx').on(t.windowStart),
	],
);

export const gatewayKeysRelations = relations(gatewayKeys, ({ one }) => ({
	organization: one(organization, {
		fields: [gatewayKeys.orgId],
		references: [organization.id],
	}),
	creator: one(user, { fields: [gatewayKeys.createdBy], references: [user.id] }),
}));

export const providerKeysRelations = relations(providerKeys, ({ one }) => ({
	organization: one(organization, {
		fields: [providerKeys.orgId],
		references: [organization.id],
	}),
}));
