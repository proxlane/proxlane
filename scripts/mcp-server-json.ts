// The MCP registry's `server.json` for `@proxlane/sdk`, generated at publish time, never committed.
//
// The registry wants the server's version in two places, and both must name an npm version that
// exists and whose package.json carries a matching `mcpName`. A committed file would be bumped by
// hand after `changeset version` bumped the package, which is a release-day chore that drifts the
// first time someone forgets it. So the file is derived from the manifest on the commit.
//
// IDEMPOTENT, so any run repairs a missing listing. The first draft ran inside the release job
// and keyed off "this release published the SDK"; a re-run publishes nothing, so a failed listing
// stayed missing until the next SDK release. Now each run asks the registry whether this version
// is listed, and publishes only when it is not and npm already has it.
//
// `node scripts/mcp-server-json.ts <out>`. Writes `<out>`, and `publish=true|false` and the
// `listing` URL to `$GITHUB_OUTPUT`. Exits 1 only when npm never shows the version the commit
// names.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const REGISTRY = 'https://registry.modelcontextprotocol.io/v0.1/servers';

export interface SdkManifest {
	readonly name: string;
	readonly version: string;
	readonly mcpName?: string;
}

/** The registry caps `description` at 100 characters, so it is written here, not reused. */
export const DESCRIPTION =
	'Web fetch for agents through your own Proxlane gateway. Block pages come back as failures.';

export function serverJson(pkg: SdkManifest) {
	if (pkg.mcpName === undefined) {
		// The registry checks the published package for this field and rejects the server
		// without it. Failing here says which file to fix; the registry's error does not.
		throw new Error(`${pkg.name} has no "mcpName" in its package.json`);
	}
	return {
		$schema: SCHEMA,
		name: pkg.mcpName,
		description: DESCRIPTION,
		repository: {
			url: 'https://github.com/proxlane/proxlane',
			source: 'github',
			subfolder: 'packages/sdk',
		},
		websiteUrl: 'https://proxlane.dev/docs/agents',
		version: pkg.version,
		packages: [
			{
				registryType: 'npm',
				identifier: pkg.name,
				version: pkg.version,
				transport: { type: 'stdio' },
				environmentVariables: [
					{
						name: 'PROXLANE_API_KEY',
						description: "The gateway's own PROXLANE_API_KEY, not a provider's",
						isRequired: true,
						isSecret: true,
					},
					{
						name: 'PROXLANE_URL',
						description: 'Where the gateway listens',
						default: 'http://localhost:8787',
					},
				],
			},
		],
	};
}

/** Where the registry answers 200 for a listed version and 404 for one it does not have. */
export function listingUrl(mcpName: string, version: string): string {
	return `${REGISTRY}/${encodeURIComponent(mcpName)}/versions/${encodeURIComponent(version)}`;
}

/** A lookup's status as a fact. Anything but 200 or 404 is not an answer, so it throws. */
export function listed(status: number): boolean {
	if (status === 200) return true;
	if (status === 404) return false;
	throw new Error(`the MCP registry answered ${status}; cannot tell whether this is listed`);
}

/** What npm holds for this version: not yet, a version that predates the listing, or one to list. */
type OnNpm = 'absent' | 'no-mcpName' | 'listable';

async function onNpm(pkg: SdkManifest): Promise<OnNpm> {
	// The registry validates against npm, and npm lags a publish by minutes. Same lesson as
	// verify-trusted-publish.ts: a version that has not appeared yet is not a failure yet.
	const url = `https://registry.npmjs.org/${pkg.name.replace('/', '%2f')}/${pkg.version}`;
	for (let round = 0; round < 10; round++) {
		const res = await fetch(url);
		if (res.ok) {
			const { mcpName } = (await res.json()) as SdkManifest;
			return mcpName === pkg.mcpName ? 'listable' : 'no-mcpName';
		}
		await sleep(30_000);
	}
	return 'absent';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const out = process.argv[2];
	if (out === undefined) {
		process.stderr.write('usage: node scripts/mcp-server-json.ts <out>\n');
		process.exit(2);
	}
	const pkg = JSON.parse(
		readFileSync(resolve(ROOT, 'packages/sdk/package.json'), 'utf8'),
	) as SdkManifest;
	const server = serverJson(pkg);
	writeFileSync(out, `${JSON.stringify(server, null, 2)}\n`);
	const id = `${server.name}@${pkg.version}`;

	let publish = false;
	const npm = listed((await fetch(listingUrl(server.name, pkg.version))).status)
		? undefined
		: await onNpm(pkg);
	if (npm === undefined) {
		process.stdout.write(`  ${id} is already listed; nothing to do\n`);
	} else if (npm === 'listable') {
		process.stdout.write(`  ${id} is on npm and not listed; publishing\n`);
		publish = true;
	} else if (npm === 'no-mcpName') {
		// A version published before `mcpName` existed, or a release run that published no
		// SDK. The registry would reject it, and the next SDK release lists itself.
		process.stdout.write(
			`  ${pkg.name}@${pkg.version} on npm has no mcpName; nothing to list\n`,
		);
	} else {
		process.stdout.write(`::error::${pkg.name}@${pkg.version} never appeared on npm\n`);
		process.exit(1);
	}
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			`publish=${publish}\nlisting=${listingUrl(server.name, pkg.version)}\n`,
		);
}
