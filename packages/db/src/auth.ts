// The Better Auth instance, and the single source its Drizzle schema is generated from.
//
// `operations.md` section 5 settled the shape; this is the executable form of it. Nothing here
// is hand-written schema: `@better-auth/cli generate` reads THIS file and emits
// `src/schema/auth.ts`, so the plugin set below decides the tables. That direction matters —
// an `orgs` table written by hand beside the organization plugin's `organization` is a
// collision, not a sequencing problem.
//
// It is a factory rather than a module-level instance. Building one at import time would need
// a live database handle to exist before anything could import the schema, which is backwards,
// and would make the CLI's own import of this file open a connection.

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { haveIBeenPwned, organization, twoFactor } from 'better-auth/plugins';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * OAuth providers are bring-your-own, enabled only when their credentials are present.
 *
 * `operations.md` section 5: requiring OAuth would mean a self-hoster registers a Google
 * *and* a GitHub app before they can log in to their own dashboard. Email is the zero-config
 * path; these are the hosted convenience.
 */
export interface OAuthCredentials {
	readonly clientId: string;
	readonly clientSecret: string;
}

export interface AuthConfig {
	/**
	 * A drizzle client. Typed loosely on its schema because `createAuth` is called with the
	 * full schema in the app and with a stub by the codegen entry point, and pinning the
	 * generic here would make one of those two a lie.
	 */
	readonly database: NodePgDatabase<Record<string, never>>;
	readonly secret: string;
	readonly baseURL: string;
	readonly github?: OAuthCredentials;
	readonly google?: OAuthCredentials;
}

/**
 * Which social providers a given configuration turns on.
 *
 * Exported because the sign-in page must render from this rather than from a hardcoded set of
 * buttons — a self-hoster must not be shown a Google button that 500s.
 */
export function enabledProviders(config: AuthConfig): readonly string[] {
	return [
		'email',
		...(config.github === undefined ? [] : ['github']),
		...(config.google === undefined ? [] : ['google']),
	];
}

export function createAuth(config: AuthConfig) {
	return betterAuth({
		database: drizzleAdapter(config.database, { provider: 'pg' }),
		secret: config.secret,
		baseURL: config.baseURL,

		// Always on, and never removed. See `enabledProviders`.
		emailAndPassword: { enabled: true },

		socialProviders: {
			...(config.github === undefined ? {} : { github: config.github }),
			...(config.google === undefined ? {} : { google: config.google }),
		},

		account: {
			accountLinking: {
				enabled: true,
				// Both verify email, so both are safe to link on. Without this, signing up with
				// Google and returning via GitHub on the same address creates a SECOND account
				// holding none of your provider keys, which reads as data loss every time.
				//
				// The trap this does not cover, and which the sign-up flow must: a GitHub account
				// whose email is unverified or private must not auto-link.
				trustedProviders: ['github', 'google'],
			},
		},

		plugins: [
			organization({
				// OFF. Two more tables and two more join paths for a product with no customers.
				// `operations.md` section 5 records teams as the answer to per-member scoping,
				// to be turned on when someone asks for it.
				teams: { enabled: false },
			}),
			// Required for orgs with hosted credits (phase 3), but enabled now because it adds
			// columns to `user`: switching it on later is a migration across the table every
			// other table points at.
			twoFactor(),
			// No schema, few lines. We keep passwords for the self-host path, and a stolen
			// account can SPEND provider keys even though sealed boxes mean it cannot read them.
			haveIBeenPwned(),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
