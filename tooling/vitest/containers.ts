// globalSetup for the e2e project.
//
// `integrations.md` section 6 Layer 4: real Valkey and real Postgres via testcontainers,
// nothing mocked but the network boundary to providers.
//
// This file used to start NOTHING, and said so — the gateway touched neither service, so
// booting two containers to prove it still worked would have added ~20s per run and asserted
// nothing. What it did instead was watch for the gateway acquiring a database dependency and
// fail the moment that stopped being true.
//
// It fired. `apps/gateway` took a dependency on `ioredis` and e2e went red with the reason.
// That is the check working, so the body is now implemented rather than the check removed.
//
// STILL ONLY VALKEY. Postgres is started only once something needs it, on exactly the same
// principle and with the same tripwire below. A container nobody connects to is 10 seconds
// of startup buying a green tick.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSTGRES_IMAGE, VALKEY_IMAGE } from '@proxlane/containers';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

export const IMAGES = { postgres: POSTGRES_IMAGE, valkey: VALKEY_IMAGE };

/** Dependencies that mean the gateway now needs a real Postgres. */
const POSTGRES_DEPENDENCIES = ['drizzle-orm', 'pg', 'postgres'];

function gatewayDeps(root: string): string[] {
	const pkgPath = join(root, 'apps/gateway/package.json');
	if (!existsSync(pkgPath)) return [];
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
		dependencies?: Record<string, string>;
	};
	return Object.keys(pkg.dependencies ?? {});
}

export default async function setup(): Promise<() => Promise<void>> {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
	const deps = gatewayDeps(root);

	// The same tripwire, narrowed to the service that is still not started. Postgres arrives
	// with the schema; until then, starting it would be theatre.
	const needsPostgres = deps.filter((d) => POSTGRES_DEPENDENCIES.includes(d));
	if (needsPostgres.length > 0) {
		throw new Error(
			`apps/gateway now depends on ${needsPostgres.join(', ')}, so e2e must boot ` +
				`${IMAGES.postgres} via testcontainers. This setup starts only Valkey.\n` +
				'Implement it rather than removing this check: an e2e suite running against no ' +
				'database is not an e2e suite.',
		);
	}

	const started: StartedTestContainer[] = [];

	if (deps.includes('ioredis')) {
		// `save ""` and `appendonly no`: the same no-persistence configuration the deployment
		// uses, so a test never accidentally depends on durability the real thing does not
		// have. `plan.md` records the decision.
		const valkey = await new GenericContainer(VALKEY_IMAGE)
			.withExposedPorts(6379)
			.withCommand(['valkey-server', '--save', '', '--appendonly', 'no'])
			// Wait for the log, not the port. The default strategy returns once the port is
			// listening, which is a window a server can be inside without answering — the same
			// race that made the Postgres suite fail all 17 tests at once with
			// `57P03: the database system is starting up`.
			//
			// Valkey is far less exposed to it than Postgres, having no `initdb` phase, so this is
			// closing the class rather than a failure anyone has seen here. Once, not twice: this
			// image prints the line exactly once, unlike Postgres, which prints it for its
			// temporary init server first.
			.withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/i))
			.start();
		started.push(valkey);
		process.env.PROXLANE_VALKEY_URL = `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
		process.stdout.write(`  e2e: valkey on ${process.env.PROXLANE_VALKEY_URL}\n`);
	}

	if (started.length === 0) {
		process.stdout.write(
			'  e2e: no containers started — the gateway needs no backing service yet. ' +
				'This setup fails automatically once it does.\n',
		);
	}

	return async () => {
		await Promise.all(started.map((c) => c.stop()));
	};
}
