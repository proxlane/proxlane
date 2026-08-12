// The two fixtures below are real registry shapes, read on 2026-08-12:
// `proxlane@0.1.0` (published with a token) and `tuf-js` (trusted publishing).

import { describe, expect, it } from 'vitest';
import {
	describe as describeEvidence,
	evidenceFor,
	type Fetcher,
	parsePublished,
	trustEvidence,
	type VersionManifest,
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

	it('gives up as none when the version never appears', async () => {
		const fetcher: Fetcher = async () => ({});
		expect(await evidenceFor(pkg, fetcher, { attempts: 3, waitMs: 0, sleep: noSleep })).toBe(
			'none',
		);
	});

	it('treats a network failure as absence rather than crashing the release', async () => {
		const fetcher: Fetcher = async () => {
			throw new Error('ECONNRESET');
		};
		expect(await evidenceFor(pkg, fetcher, { attempts: 2, waitMs: 0, sleep: noSleep })).toBe(
			'none',
		);
	});
});
