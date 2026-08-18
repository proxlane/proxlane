// A real Postgres 17 for the migration suite.
//
// The image constant is shared with the compose file via `@proxlane/containers`, and
// `repo:check` assertion 8 asserts the two agree — so this cannot drift into testing a
// different major than self-hosters run.

import { POSTGRES_IMAGE } from '@proxlane/containers';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

let container: StartedTestContainer | undefined;

export default async function setup(): Promise<() => Promise<void>> {
	container = await new GenericContainer(POSTGRES_IMAGE)
		.withEnvironment({
			POSTGRES_USER: 'proxlane',
			POSTGRES_PASSWORD: 'proxlane',
			POSTGRES_DB: 'proxlane',
		})
		.withExposedPorts(5432)
		// WAIT FOR THE LOG, NOT THE PORT, and the count of two is the whole fix.
		//
		// testcontainers' default is to wait for the exposed port to listen. Postgres binds its
		// port before it has finished initialising and answers `FATAL 57P03: the database system
		// is starting up` in the meantime — so the container reported ready, every connection was
		// refused with that, and all 17 tests failed at once. Seen in CI on 2026-08-17; it passed
		// on a re-run, which is what makes this the corrosive kind of failure: a required check
		// that is sometimes wrong teaches people to press the button rather than read the output.
		//
		// The official image prints "ready to accept connections" TWICE: once for the temporary
		// server `initdb` runs to create the database and apply the init scripts, and again for
		// the real one. Waiting for the first is the same race with extra steps — it is the
		// classic wrong version of this fix — so this waits for the second.
		.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
		.start();

	const url = `postgres://proxlane:proxlane@${container.getHost()}:${container.getMappedPort(5432)}/proxlane`;
	process.env.DATABASE_URL = url;
	// Also on the vitest side, because globalSetup runs in a different process from the tests.
	process.env.TEST_DATABASE_URL = url;

	return async () => {
		await container?.stop();
	};
}
