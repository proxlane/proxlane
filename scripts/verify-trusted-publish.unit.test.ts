// The two fixtures below are real registry shapes, read on 2026-08-12:
// `proxlane@0.1.0` (published with a token) and `tuf-js` (trusted publishing).

import { describe, expect, it } from 'vitest';
import {
	describe as describeEvidence,
	evidenceFor,
	type Fetcher,
	isPrivate,
	parsePublished,
	trustEvidence,
	type VersionManifest,
	verifyAll,
} from './verify-trusted-publish.js';

const TOKEN_PUBLISHED: VersionManifest = {
	_npmUser: { name: 'samojling', email: 's.ojling@gmail.com' } as never,
	dist: { attestations: { provenance: { predicateType: 'https://slsa.dev/provenance/v1' } } },
};

const OIDC_PUBLISHED: VersionManifest = {
	_npmUser: {
		name: 'bdehamer',
		trustedPublisher: {
			id: 'github',
			oidcConfigId: 'oidc:66c23ee7-8391-40a4-bf78-ad32bcd1163b',
		},
	} as never,
	dist: { attestations: { provenance: {} } },
};

const noSleep = (): Promise<void> => Promise.resolve();

describe('trust evidence, against real registry shapes', () => {
	it('reads a token publish as provenance only, NOT as trusted', () => {
		// The whole point. Provenance is present in both cases, so keying on attestations alone
		// would report success for the exact regression this check exists to catch.
		expect(trustEvidence(TOKEN_PUBLISHED)).toBe('provenance');
	});

	it('reads an OIDC publish as trustedPublisher', () => {
		expect(trustEvidence(OIDC_PUBLISHED)).toBe('trustedPublisher');
	});

	it('reads a bare publish as none', () => {
		expect(trustEvidence({})).toBe('none');
		expect(trustEvidence(undefined)).toBe('none');
	});

	it('describes the token case in words that name the problem', () => {
		expect(describeEvidence('provenance')).toMatch(/NOT OIDC/);
	});
});

describe('publishedPackages parsing', () => {
	it('parses what changesets/action emits', () => {
		expect(parsePublished('[{"name":"proxlane","version":"0.1.0"}]')).toEqual([
			{ name: 'proxlane', version: '0.1.0' },
		]);
	});

	it('rejects a malformed entry rather than silently checking nothing', () => {
		expect(() => parsePublished('[{"name":"x"}]')).toThrow(/malformed/);
		expect(() => parsePublished('{}')).toThrow(/not an array/);
	});
});

describe('private packages are not on npm, so there is nothing to verify', () => {
	// THE FALSE ALARM THIS PREVENTS. `changesets/action` lists everything it VERSIONED in
	// `publishedPackages`, not everything it published — and once `privatePackages.tag` was
	// turned on, the ten private packages joined that list. Every one came back "no trust
	// evidence at all", because they never went near the registry, and a release whose three
	// real publishes had all used OIDC correctly went red.

	it('knows the packages this repo never publishes', () => {
		for (const name of ['@proxlane/gateway', '@proxlane/web', '@proxlane/db']) {
			expect(isPrivate(name), `${name} is private: true`).toBe(true);
		}
	});

	it('finds private packages outside packages/ and apps/', () => {
		// The first version listed the directories packages live in and missed these two, which
		// are at `scripts/` and `test/k6/`. A hardcoded root list stops covering the workspace
		// the moment someone adds a directory.
		expect(isPrivate('@proxlane/scripts')).toBe(true);
		expect(isPrivate('@proxlane/k6-harness')).toBe(true);
	});

	it('does not treat a published package as private', () => {
		for (const name of ['@proxlane/adapters', '@proxlane/shared', 'proxlane']) {
			expect(isPrivate(name), `${name} publishes`).toBe(false);
		}
	});

	it('treats an unknown name as publishable, so it is still checked', () => {
		// Fails OPEN in the direction that keeps checking. Silently skipping a name we cannot
		// classify would let a real credential regression through, which is the one thing this
		// file exists to catch.
		expect(isPrivate('@proxlane/not-a-real-package')).toBe(false);
	});
});

describe('retrying while the registry catches up', () => {
	const pkg = { name: 'proxlane', version: '0.1.0' };

	it('retries an absent version, then reports it once it appears', async () => {
		let calls = 0;
		const fetcher: Fetcher = async () => {
			calls++;
			return calls < 3 ? {} : { '0.1.0': OIDC_PUBLISHED };
		};
		const got = await evidenceFor(pkg, fetcher, { attempts: 5, waitMs: 0, sleep: noSleep });
		expect(got).toBe('trustedPublisher');
		expect(calls).toBe(3);
	});

	it('returns a definite answer immediately without burning retries', async () => {
		let calls = 0;
		const fetcher: Fetcher = async () => {
			calls++;
			return { '0.1.0': TOKEN_PUBLISHED };
		};
		expect(await evidenceFor(pkg, fetcher, { attempts: 5, waitMs: 0, sleep: noSleep })).toBe(
			'provenance',
		);
		expect(calls).toBe(1);
	});

	it('gives up as ABSENT, not none, when the version never appears', async () => {
		// The distinction that was missing. "Never appeared" is a fact about propagation;
		// "appeared with no evidence" is the regression. The 0.16.0 release printed the second
		// message for the first situation.
		const fetcher: Fetcher = async () => ({});
		expect(await evidenceFor(pkg, fetcher, { attempts: 3, waitMs: 0, sleep: noSleep })).toBe(
			'absent',
		);
	});

	it('treats a network failure as absence rather than crashing the release', async () => {
		const fetcher: Fetcher = async () => {
			throw new Error('ECONNRESET');
		};
		expect(await evidenceFor(pkg, fetcher, { attempts: 2, waitMs: 0, sleep: noSleep })).toBe(
			'absent',
		);
	});

	it('keeps none once the version has been seen without evidence', async () => {
		// A partial write is retried, but a later empty read must not demote a real "none"
		// back to "never appeared" — that would turn a regression into a propagation notice.
		let calls = 0;
		const fetcher: Fetcher = async () => {
			calls++;
			return calls === 1 ? { '0.1.0': {} } : {};
		};
		expect(await evidenceFor(pkg, fetcher, { attempts: 3, waitMs: 0, sleep: noSleep })).toBe(
			'none',
		);
	});
});

describe('the whole list is retried in rounds, not one package at a time', () => {
	// THE 0.16.0 FAILURE, reproduced. Three packages published together; the registry shows
	// the first one late. Per-package retries gave the first name the shortest effective wait
	// — checked within seconds of publish — and failed it while the two checked afterwards
	// passed. Rounds give every package the same window, measured from the same moment.
	const adapters = { name: '@proxlane/adapters', version: '0.10.2' };
	const cli = { name: 'proxlane', version: '0.4.14' };
	const shared = { name: '@proxlane/shared', version: '0.12.0' };

	it('passes a package that appears late while the others settle in round one', async () => {
		const reads: Record<string, number> = {};
		const fetcher: Fetcher = async (name) => {
			reads[name] = (reads[name] ?? 0) + 1;
			if (name === adapters.name) {
				return (reads[name] ?? 0) < 3 ? {} : { '0.10.2': OIDC_PUBLISHED };
			}
			return name === cli.name ? { '0.4.14': OIDC_PUBLISHED } : { '0.12.0': OIDC_PUBLISHED };
		};
		let sleeps = 0;
		const got = await verifyAll([adapters, cli, shared], fetcher, {
			rounds: 5,
			waitMs: 0,
			sleep: async () => {
				sleeps++;
			},
		});
		expect(got.get(adapters.name)).toBe('trustedPublisher');
		expect(got.get(cli.name)).toBe('trustedPublisher');
		expect(got.get(shared.name)).toBe('trustedPublisher');
		// The settled two are not re-read; only the straggler costs another round.
		expect(reads[cli.name]).toBe(1);
		expect(reads[shared.name]).toBe(1);
		expect(reads[adapters.name]).toBe(3);
		expect(sleeps).toBe(2);
	});

	it('does not sleep at all when everything settles in round one', async () => {
		const fetcher: Fetcher = async (name) =>
			name === cli.name ? { '0.4.14': OIDC_PUBLISHED } : { '0.12.0': OIDC_PUBLISHED };
		let sleeps = 0;
		await verifyAll([cli, shared], fetcher, {
			rounds: 12,
			waitMs: 10_000,
			sleep: async () => {
				sleeps++;
			},
		});
		expect(sleeps).toBe(0);
	});

	it('reports a token publish as provenance without waiting for the rounds to run out', async () => {
		// A definite bad answer is settled too. Retrying it would delay the one message this
		// file exists to print.
		let reads = 0;
		const fetcher: Fetcher = async () => {
			reads++;
			return { '0.1.0': TOKEN_PUBLISHED };
		};
		const got = await verifyAll([{ name: 'proxlane', version: '0.1.0' }], fetcher, {
			rounds: 5,
			waitMs: 0,
			sleep: noSleep,
		});
		expect(got.get('proxlane')).toBe('provenance');
		expect(reads).toBe(1);
	});
});
