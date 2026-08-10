// globalSetup for the e2e project.
//
// `integrations.md` section 6 Layer 4 says real Postgres and real Valkey via testcontainers,
// nothing mocked but the network boundary to providers. That is the destination.
//
// It is NOT what happens today, and pretending otherwise would be the more expensive lie.
// The gateway currently touches neither database: there is no request log, no cooldown
// state, no key store. Booting two containers to prove a gateway that never connects to
// them still works would add ~20s to every run and assert nothing — a slow vacuous pass is
// still a vacuous pass.
//
// So this starts nothing, says so, and — the part that matters — FAILS THE MOMENT IT
// BECOMES WRONG. The check below watches for the gateway acquiring a database dependency.
// The day someone adds drizzle or ioredis, e2e goes red with an explanation rather than
// silently continuing to test against no database at all.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSTGRES_IMAGE, VALKEY_IMAGE } from '@proxlane/containers';

export const IMAGES = { postgres: POSTGRES_IMAGE, valkey: VALKEY_IMAGE };

/** Dependencies whose presence means the gateway now needs a real backing service. */
const DB_DEPENDENCIES = ['drizzle-orm', 'ioredis', 'pg', 'postgres'];

export default async function setup(): Promise<() => Promise<void>> {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
	const pkgPath = join(root, 'apps/gateway/package.json');

	if (existsSync(pkgPath)) {
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
			dependencies?: Record<string, string>;
		};
		const found = Object.keys(pkg.dependencies ?? {}).filter((d) =>
			DB_DEPENDENCIES.includes(d),
		);
		if (found.length > 0) {
			throw new Error(
				`apps/gateway now depends on ${found.join(', ')}, so e2e must boot real ` +
					`services — ${IMAGES.postgres} and ${IMAGES.valkey} — via testcontainers.\n` +
					'This setup starts nothing. Implement it rather than removing this check: an ' +
					'e2e suite running against no database is not an e2e suite.',
			);
		}
	}

	process.stdout.write(
		'  e2e: no containers started — the gateway uses no database yet. ' +
			'This setup fails automatically once it does.\n',
	);
	return async () => {
		// Nothing to tear down. Kept so the contract stays a teardown-returning setup and the
		// day containers arrive, only the body changes.
	};
}
