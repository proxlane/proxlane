// Layer 2: the whole request lifecycle against replayed reality. `pnpm test:contract`.
//
// The difference from the unit tests next door is what is real. Those use hand-made
// adapters returning a chosen outcome, and test what the CHAIN decides. These run the real
// three adapters — real translate(), real parse(), real capabilities — over bytes a real
// provider actually sent, and test that the whole path agrees end to end.
//
// The difference from conformance is where the boundary sits. Conformance calls parse()
// directly. Here the recording goes through the transport, so translate() has to produce a
// request the recording matches, and the failover walk has to reach the right verdict.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Adapter, REGISTRY } from '@proxlane/adapters';
import {
	createReplayTransport,
	loadFixtures,
	NoRecordingError,
	type ReplayEntry,
} from '@proxlane/vitest-config/replay-transport';
import { describe, expect, it } from 'vitest';
import { runChain } from './chain.js';
import type { HttpTransport } from './transport.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const IDS = Object.keys(REGISTRY).sort();

const adapters = new Map<string, Adapter>();
for (const id of IDS) adapters.set(id, await (REGISTRY[id] as () => Promise<Adapter>)());

function fixtures(id: string): ReplayEntry[] {
	return loadFixtures(ROOT, id);
}

/** The recorded target for a category, so the chain asks for the thing that was recorded. */
function targetOf(id: string, category: string): { url: string; renderJs: boolean } {
	const f = fixtures(id).find((e) => e.category === category);
	if (f === undefined) throw new Error(`${id} has no ${category} fixture`);
	return f.recording.target;
}

function chainOver(entries: ReplayEntry[], ids: string[]) {
	const transport = createReplayTransport(entries);
	// The structural type is asserted here, at the point of use. tooling/ does not import
	// from apps/gateway — depending upwards for a type alias would invert the layering — so
	// this is what stops the two definitions drifting apart unnoticed.
	const asTransport: HttpTransport = transport;
	return {
		transport,
		deps: {
			transport: asTransport,
			candidates: ids.map((id) => ({
				adapter: adapters.get(id) as Adapter,
				key: 'REPLAY_KEY',
			})),
			maxBodyBytes: 10 * 1024 * 1024,
		},
	};
}

describe.each(IDS)('%s, through the full chain against its own recordings', (id) => {
	const cases = [
		['success-html', 'OK'],
		['success-json', 'OK'],
		['render-js', 'OK'],
		['target-not-found', 'TARGET_NOT_FOUND'],
		['target-error', 'TARGET_ERROR'],
	] as const;

	for (const [category, expected] of cases) {
		it(`${category} → ${expected}`, async () => {
			const target = targetOf(id, category);
			const { deps } = chainOver(fixtures(id), [id]);
			const r = await runChain(
				{
					url: target.url,
					method: 'GET',
					renderJs: target.renderJs,
					premium: 'none',
					deadlineMs: 90_000,
				},
				deps,
			);
			expect(r.outcome).toBe(expected);
			expect(r.provider).toBe(id);
		});
	}

	it('carries the page bytes back unmodified on a success', async () => {
		// End to end: recorded base64 → transport → parse() → chain result, with no decode in
		// between. This is the property the whole fixture format exists to protect.
		const target = targetOf(id, 'success-html');
		const { deps } = chainOver(fixtures(id), [id]);
		const r = await runChain(
			{ url: target.url, method: 'GET', renderJs: false, premium: 'none', deadlineMs: 90_000 },
			deps,
		);
		expect(r.result?.body).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(r.result?.body)).toContain('Herman Melville');
	});
});

describe('the failover walk, over real recorded bytes', () => {
	it('stops after ONE attempt on a 404, even with two providers to spare', async () => {
		// FAILOVER says TARGET_NOT_FOUND never fails over, and this is where that stops being
		// a table entry and starts saving money: ScraperAPI charges for a 404, so a chain that
		// retried one would bill three times to reach the same answer.
		const entries = IDS.flatMap((id) => fixtures(id));
		const { transport, deps } = chainOver(entries, IDS);
		const r = await runChain(
			{
				url: targetOf(IDS[0] as string, 'target-not-found').url,
				method: 'GET',
				renderJs: false,
				premium: 'none',
				deadlineMs: 90_000,
			},
			deps,
		);
		expect(r.outcome).toBe('TARGET_NOT_FOUND');
		expect(r.attempts).toHaveLength(1);
		expect(transport.served).toHaveLength(1);
	});

	it('fails over exactly ONCE on a target error, then stops', async () => {
		// All three providers really do return a target error for httpbin.dev/status/503 —
		// verified when the fixtures were recorded — so this walks two real providers and
		// stops, rather than exhausting the chain.
		const entries = IDS.flatMap((id) => fixtures(id));
		const { transport, deps } = chainOver(entries, IDS);
		const r = await runChain(
			{
				url: targetOf(IDS[0] as string, 'target-error').url,
				method: 'GET',
				renderJs: false,
				premium: 'none',
				deadlineMs: 90_000,
			},
			deps,
		);
		expect(r.outcome).toBe('TARGET_ERROR');
		expect(r.attempts).toHaveLength(2);
		expect(transport.served).toHaveLength(2);
	});

	it('gives hop 1 fastTimeoutMs and the terminal hop maxTimeoutMs', async () => {
		const entries = IDS.flatMap((id) => fixtures(id));
		const { deps } = chainOver(entries, IDS);
		const r = await runChain(
			{
				url: targetOf(IDS[0] as string, 'target-error').url,
				method: 'GET',
				renderJs: false,
				premium: 'none',
				deadlineMs: 90_000,
			},
			deps,
		);
		const first = adapters.get(r.attempts[0]?.provider as string) as Adapter;
		expect(r.attempts[0]?.budgetMs).toBe(first.capabilities.fastTimeoutMs);
	});
});

describe('a deadline recording replays as a deadline', () => {
	it('becomes PROVIDER_TIMEOUT, an outcome no adapter can produce', async () => {
		// scrapfly is the one adapter with a recorded deadline: it needed --timeout-ms,
		// because no public target stays open longer than a provider's own budget.
		const withDeadline = IDS.filter((id) =>
			fixtures(id).some((e) => e.recording.kind === 'deadline'),
		);
		expect(withDeadline.length, 'no deadline fixture exists to replay').toBeGreaterThan(0);
		const id = withDeadline[0] as string;
		const target = targetOf(id, 'deadline');
		const { deps } = chainOver(fixtures(id), [id]);
		const r = await runChain(
			{ url: target.url, method: 'GET', renderJs: false, premium: 'none', deadlineMs: 90_000 },
			deps,
		);
		expect(r.outcome).toBe('PROVIDER_TIMEOUT');
	});
});

describe('a miss is fatal, never a plausible answer', () => {
	it('throws rather than inventing a response for an unrecorded target', async () => {
		// The property the whole layer rests on. A transport that answered a miss with a
		// synthesised 404 would make every test above it decorative, and it would do so
		// silently — the same reason `pnpm record` refuses to hand-write a block fixture.
		const id = IDS[0] as string;
		const { deps } = chainOver(fixtures(id), [id]);
		await expect(
			runChain(
				{
					url: 'https://never-recorded.example/',
					method: 'GET',
					renderJs: false,
					premium: 'none',
					deadlineMs: 90_000,
				},
				deps,
			),
		).rejects.toBeInstanceOf(NoRecordingError);
	});

	it('will not replay a non-rendered recording for a rendered request', async () => {
		// renderJs is part of what a recording IS. Matching across it would answer a different
		// question and call it a pass.
		const id = IDS[0] as string;
		const plain = fixtures(id).filter((e) => e.category === 'success-html');
		const { deps } = chainOver(plain, [id]);
		await expect(
			runChain(
				{
					url: targetOf(id, 'success-html').url,
					method: 'GET',
					renderJs: true,
					premium: 'none',
					deadlineMs: 90_000,
				},
				deps,
			),
		).rejects.toBeInstanceOf(NoRecordingError);
	});
});

describe('a recording belongs to the provider that made it', () => {
	it("never serves one provider a different provider's bytes", async () => {
		// This was a real bug in the harness, caught by the failover test above. Every adapter
		// records the same targets, so with a shared pool the entries look interchangeable —
		// and ScrapingBee's parse() was handed ScraperAPI's HTML and returned PROVIDER_ERROR.
		// It failed in a way that reads like an adapter bug rather than a harness bug, which
		// is the expensive kind.
		expect(IDS.length, 'needs at least two adapters to be meaningful').toBeGreaterThan(1);
		const pool = IDS.flatMap((id) => fixtures(id));

		for (const id of IDS) {
			const { transport, deps } = chainOver(pool, [id]);
			const target = targetOf(id, 'success-html');
			const r = await runChain(
				{
					url: target.url,
					method: 'GET',
					renderJs: false,
					premium: 'none',
					deadlineMs: 90_000,
				},
				deps,
			);
			expect(r.outcome, `${id} parsed something that was not its own`).toBe('OK');
			// And the request really did go to that provider's endpoint.
			const host = fixtures(id)[0]?.host as string;
			expect(new URL(transport.served[0] as string).host).toBe(host);
		}
	});
});

describe('the corpus itself', () => {
	it('is non-empty for every registered adapter', () => {
		// Non-zero denominator: a replay suite over no recordings passes every assertion in
		// this file by examining nothing.
		expect(IDS.length).toBeGreaterThan(0);
		for (const id of IDS) {
			expect(fixtures(id).length, `${id} has no recordings`).toBeGreaterThan(0);
		}
	});

	it('has no fixture the recorder could not have written', () => {
		for (const id of IDS) {
			for (const e of fixtures(id)) {
				expect(['exchange', 'deadline']).toContain(e.recording.kind);
				expect(e.recording.target.url, `${id}/${e.category}`).toMatch(/^https?:\/\//);
			}
		}
	});

	it('contains no provider key, in any fixture', () => {
		// Belt and braces over the recorder's own post-write assertion. These files are
		// committed and public; the check is cheap and the failure is not.
		for (const id of IDS) {
			const dir = join(ROOT, 'packages/adapters/src', id, 'fixtures');
			for (const e of fixtures(id)) {
				const raw = readFileSync(join(dir, `${e.category}.json`), 'utf8');
				for (const envVar of ['SCRAPERAPI_KEY', 'SCRAPINGBEE_KEY', 'SCRAPFLY_KEY']) {
					const key = process.env[envVar];
					if (key !== undefined && key !== '') {
						expect(raw.includes(key), `${id}/${e.category} contains $${envVar}`).toBe(false);
					}
				}
			}
		}
	});
});
