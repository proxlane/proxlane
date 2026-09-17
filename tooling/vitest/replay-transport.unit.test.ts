import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReplayTransport, loadFixtures } from './replay-transport.js';

// A spent plan's refusal carries the url of the target it interrupted. Matching is by url and
// the first hit wins, and `quota-exhausted` sorts before `success-html`, so loading it would
// replay an empty wallet as the answer to the happy path.
describe('a recorded quota refusal is never replayed', () => {
	const exchange = (category: string, status: number) =>
		JSON.stringify({
			kind: 'exchange',
			category,
			target: { url: 'https://httpbin.dev/html', renderJs: false },
			request: { method: 'GET', url: 'https://api.provider.test/?url=REDACTED' },
			response: { status, headers: {}, bodyBase64: '' },
		});

	it('serves the target recording, not the refusal recorded against the same url', async () => {
		const root = mkdtempSync(join(tmpdir(), 'replay-quota-'));
		const dir = join(root, 'packages/adapters/src/x/fixtures');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'quota-exhausted.json'), exchange('quota-exhausted', 403));
		writeFileSync(join(dir, 'success-html.json'), exchange('success-html', 200));

		const entries = loadFixtures(root, 'x');
		expect(entries.map((e) => e.category)).toEqual(['success-html']);

		const r = await createReplayTransport(entries).execute(
			{
				method: 'GET',
				url: `https://api.provider.test/?url=${encodeURIComponent('https://httpbin.dev/html')}`,
				headers: {},
				timeoutMs: 1_000,
			},
			{ budgetMs: 1_000 },
		);
		expect(r.kind === 'response' && r.response.status).toBe(200);
	});
});
