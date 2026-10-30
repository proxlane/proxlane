// Single use, in one process. Its Valkey twin is held to the same in `valkey.e2e.test.ts`.

import { describe, expect, it } from 'vitest';
import { InMemoryGrantStore } from './grant-store.js';

describe('the in-memory grant store', () => {
	it('claims an id once, until it expires', async () => {
		let now = 0;
		const g = new InMemoryGrantStore(() => now);
		expect(await g.claim('a', 1000)).toBe(true);
		expect(await g.claim('a', 1000)).toBe(false);
		now = 1001;
		expect(await g.claim('a', 1000)).toBe(true);
	});

	it('revokes a family for its lifetime', async () => {
		let now = 0;
		const g = new InMemoryGrantStore(() => now);
		await g.revoke('f', 1000);
		expect(await g.revoked('f')).toBe(true);
		now = 1001;
		expect(await g.revoked('f')).toBe(false);
	});

	it('sweeps expired entries as it writes, so it does not keep every code it saw', async () => {
		let now = 0;
		const g = new InMemoryGrantStore(() => now);
		for (let i = 0; i < 50; i++) await g.claim(`old${i}`, 10);
		now = 100;
		for (let i = 0; i < 10; i++) await g.claim(`new${i}`, 10);
		expect(g.size).toBeLessThan(60);
	});
});
