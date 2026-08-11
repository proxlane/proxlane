// The gateway's configuration surface, checked against the file that actually supplies it.
//
// This exists because of a defect that every one of the ten PR-blocking checks missed: three
// documented environment variables were never listed in `docker/compose.yml`'s `environment:`
// block, so setting them did nothing on the only deployment path this project ships. And the
// fourth was listed as `${PROXLANE_VALKEY_URL:-}`, which sets it to an EMPTY STRING rather
// than leaving it unset — so a default self-host deployment built `new Redis('')`, logged
// ECONNREFUSED forever, and returned 500 from `/health/providers`, while the boot banner
// claimed `state: valkey (shared)`.
//
// Nothing caught it because nothing reads the compose file. `pnpm selfhost:smoke` deploys it
// but only asserts the endpoints it knew about before this feature existed.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertSingleWriter } from './health-store.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Every PROXLANE_* variable the gateway's entrypoint reads. */
function varsReadByGateway(): string[] {
	const src = read('apps/gateway/src/index.ts');
	return [...new Set([...src.matchAll(/PROXLANE_[A-Z_]+/g)].map((m) => m[0] as string))].sort();
}

/** Every PROXLANE_* variable the self-host compose passes into the container. */
function varsPassedByCompose(): string[] {
	const yaml = read('docker/compose.yml');
	const env = /\n {4}environment:\n((?: {6}.*\n|\n)*)/.exec(yaml)?.[1] ?? '';
	return [
		...new Set([...env.matchAll(/^ {6}(PROXLANE_[A-Z_]+):/gm)].map((m) => m[1] as string)),
	].sort();
}

describe('the shipped compose supplies what the gateway reads', () => {
	it('parses both sides, or this test is asserting nothing', () => {
		// Non-zero denominator. A regex that silently matched nothing would make every
		// assertion below vacuously true, which is the failure this whole file exists about.
		expect(varsReadByGateway().length).toBeGreaterThan(3);
		expect(varsPassedByCompose().length).toBeGreaterThan(3);
	});

	it('names every variable the gateway reads', () => {
		const missing = varsReadByGateway().filter((v) => !varsPassedByCompose().includes(v));
		expect(
			missing,
			`docker/compose.yml does not pass ${missing.join(', ')} into the container, so ` +
				'setting them in .env does nothing. Compose only forwards what is named in ' +
				'`environment:`.',
		).toEqual([]);
	});

	it('documents every variable in .env.example', () => {
		const example = read('.env.example');
		const undocumented = varsReadByGateway().filter((v) => !example.includes(v));
		expect(undocumented, 'read by the gateway but absent from .env.example').toEqual([]);
	});
});

describe('empty is treated as unset', () => {
	// Compose cannot express "leave this unset": the conventional `${VAR:-}` defines it as
	// an empty string. Any code testing `=== undefined` is therefore wrong in deployment.
	it('every optional variable in compose uses the :- form, so empty is the default', () => {
		const yaml = read('docker/compose.yml');
		const optional = [...yaml.matchAll(/^ {6}(PROXLANE_[A-Z_]+): \$\{[A-Z_]+(:-[^}]*)?\}/gm)];
		expect(optional.length).toBeGreaterThan(0);
		for (const m of optional) {
			// PROXLANE_API_KEY uses `:?` and must stay required — it is the one that refuses to
			// boot rather than run an open proxy.
			if (m[1] === 'PROXLANE_API_KEY') continue;
			expect(
				m[2],
				`${m[1]} has no default; an unset host var would break compose`,
			).toBeDefined();
		}
	});

	it('the entrypoint reads env through a helper that rejects empty', () => {
		// Structural rather than behavioural, because index.ts starts a server on import.
		// What must not come back is a direct `process.env.PROXLANE_X` comparison.
		const src = read('apps/gateway/src/index.ts');
		const direct = [...src.matchAll(/process\.env\.PROXLANE_[A-Z_]+/g)].map((m) => m[0]);
		expect(
			direct,
			'read these through env(), which treats empty as absent — compose sets empty, not unset',
		).toEqual([]);
	});
});

describe('the gateway key comparison is constant time in fact, not in intent', () => {
	// SECURITY.md claims constant time without qualification. The previous implementation
	// short-circuited on length — leaking key length over the network in O(1) — and a
	// charCodeAt loop is not a constant-time primitive anyway: V8 may deoptimise it and sliced
	// or rope string representations make per-character access non-uniform.
	it('uses timingSafeEqual over fixed-width digests', () => {
		const src = read('apps/gateway/src/app.ts');
		expect(src).toContain('timingSafeEqual');
		expect(src, 'a length short-circuit leaks key length').not.toMatch(
			/presented\.length !== expected\.length/,
		);
	});

	it('says nothing different for a wrong key of the wrong length', async () => {
		// Behavioural, not just structural: both must be rejected identically.
		const { createApp } = await import('./app.js');
		const app = createApp({
			transport: { execute: () => Promise.reject(new Error('unused')) },
			candidates: [],
			apiKey: 'the-real-key-which-is-long',
			maxBodyBytes: 1024,
			defaultDeadlineMs: 1000,
		});
		const short = await app.request('/v1?api_key=x&url=https://example.com/');
		const long = await app.request(`/v1?api_key=${'y'.repeat(200)}&url=https://example.com/`);
		expect(short.status).toBe(401);
		expect(long.status).toBe(401);
		expect(await short.text()).toBe(await long.text());
	});
});

describe('assertSingleWriter rejects what it cannot understand', () => {
	it('allows one replica, or an unset value', () => {
		expect(() => assertSingleWriter('1')).not.toThrow();
		expect(() => assertSingleWriter(1)).not.toThrow();
	});

	it('refuses more than one against process-local state', () => {
		expect(() => assertSingleWriter('2')).toThrow(/in-process/);
	});

	it('refuses a value it cannot parse, rather than passing it', () => {
		// `Number('two')` is NaN and `NaN > 1` is false, so the previous numeric signature let a
		// typo through the guard entirely — a misconfiguration that read as a clean boot.
		for (const bad of ['two', '', 'yes', '0', '-1']) {
			expect(() => assertSingleWriter(bad), `accepted ${JSON.stringify(bad)}`).toThrow();
		}
	});
});
