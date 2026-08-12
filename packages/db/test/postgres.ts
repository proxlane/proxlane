// A real Postgres 17 for the migration suite.
//
// The image constant is shared with the compose file via `@proxlane/containers`, and
// `repo:check` assertion 8 asserts the two agree — so this cannot drift into testing a
// different major than self-hosters run.

import { POSTGRES_IMAGE } from '@proxlane/containers';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

let container: StartedTestContainer | undefined;

export default async function setup(): Promise<() => Promise<void>> {
	container = await new GenericContainer(POSTGRES_IMAGE)
		.withEnvironment({
			POSTGRES_USER: 'proxlane',
			POSTGRES_PASSWORD: 'proxlane',
			POSTGRES_DB: 'proxlane',
		})
		.withExposedPorts(5432)
		.start();

	const url = `postgres://proxlane:proxlane@${container.getHost()}:${container.getMappedPort(5432)}/proxlane`;
	process.env.DATABASE_URL = url;
	// Also on the vitest side, because globalSetup runs in a different process from the tests.
	process.env.TEST_DATABASE_URL = url;

	return async () => {
		await container?.stop();
	};
}
