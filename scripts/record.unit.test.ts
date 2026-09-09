// The recorder must be right BEFORE a key exists, because credits do not refund and a
// leaked key in a committed fixture is unrecoverable once pushed.
//
// Everything here runs without a provider key and without spending anything.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
	MAX_FIXTURE_BYTES,
	partitionByOnly,
	reportDiff,
	sanitize,
	sanitizeHeaders,
	TARGETS,
} from './record.ts';

// Spawns a subprocess per case, so the unit of work is a process rather than a function call.
// vitest's 5s default was never chosen for that — it is what applies when nobody says
// otherwise, and it leaves a spawn almost no headroom. These have never failed in CI, where the
// runner is unloaded; they fail reliably on a developer machine that is also building something
// else, which is the case that matters, because that is where a false red costs someone an hour
// chasing a regression that is not there. The ceiling measures nothing: a few seconds each when
// the machine is idle.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(args: string[], env: Record<string, string> = {}) {
	try {
		const out = execFileSync(process.execPath, ['scripts/record.ts', ...args], {
			cwd: ROOT,
			encoding: 'utf8',
			env: { ...process.env, ...env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { code: 0, out };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; stderr?: string };
		return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
	}
}

describe('sanitize', () => {
	// Deliberately not shaped like any real vendor's key. An earlier version used an
	// `sk_live_…` string, which gitleaks correctly flagged as a Stripe token — the scanner
	// cannot know a secret is fake, and it should not try. Test data that trips the secret
	// scanner either goes red forever or gets an allowlist entry, and an allowlist carved
	// for test data is what later swallows a real leak.
	const KEY = 'proxlane-test-key-not-a-real-secret';

	it('removes the key from a query string, a header value and a body', () => {
		expect(sanitize(`https://api.example/?api_key=${KEY}&url=x`, [KEY])).toBe(
			'https://api.example/?api_key=REDACTED&url=x',
		);
		expect(sanitize(`Bearer ${KEY}`, [KEY])).toBe('Bearer REDACTED');
		expect(sanitize(`{"key":"${KEY}"}`, [KEY])).toBe('{"key":"REDACTED"}');
	});

	it('removes every occurrence, not just the first', () => {
		// Providers echo the key back in error envelopes surprisingly often.
		expect(sanitize(`${KEY} then ${KEY}`, [KEY])).toBe('REDACTED then REDACTED');
	});

	it('does not touch text that merely resembles a key', () => {
		// Shares a long prefix with KEY and differs only at the tail — the case a naive
		// prefix or fuzzy match would corrupt.
		const text = 'proxlane-test-key-not-a-real-value';
		expect(sanitize(text, [KEY])).toBe(text);
	});

	it('ignores secrets too short to replace safely', () => {
		// Replacing a 3-character "secret" would corrupt the fixture everywhere it appears
		// as ordinary text. Better to leave it and let the post-write assertion catch it.
		expect(sanitize('the cat sat', ['cat'])).toBe('the cat sat');
	});

	it('redacts auth-shaped headers whatever their value', () => {
		const out = sanitizeHeaders(
			{
				authorization: 'Bearer something-we-never-saw',
				'X-API-Key': 'another-unknown-secret',
				'set-cookie': 'session=abc',
				'content-type': 'text/html; charset=Shift_JIS',
			},
			[KEY],
		);
		expect(out.authorization).toBe('REDACTED');
		expect(out['X-API-Key']).toBe('REDACTED');
		expect(out['set-cookie']).toBe('REDACTED');
		// Content-Type must survive intact — charset resolution depends on it.
		expect(out['content-type']).toBe('text/html; charset=Shift_JIS');
	});

	it('redacts an unknown value in an underscore-separated key header', () => {
		// ScraperAPI's header is `x-sapi-api_key`. The old `api-?key` pattern could not spell
		// an underscore, so it matched nothing — the real key survived only because its VALUE
		// was known. The name matcher's whole job is the case where it is not.
		const out = sanitizeHeaders({ 'x-sapi-api_key': 'a-value-we-never-saw' }, []);
		expect(out['x-sapi-api_key']).toBe('REDACTED');
	});

	it('redacts by name even with no secrets supplied at all', () => {
		const out = sanitizeHeaders({ api_key: 'x', 'x-client-secret': 'y', bearer: 'z' }, []);
		expect(Object.values(out)).toEqual(['REDACTED', 'REDACTED', 'REDACTED']);
	});

	it('keeps usage counters that only LOOK secret to a substring matcher', () => {
		// `x-usage-tokens` was being redacted because "token" is a substring of it, which
		// threw away the one header that reports what a request cost.
		const out = sanitizeHeaders({ 'x-usage-tokens': '4142', 'x-token-count': '7' }, [KEY]);
		expect(out['x-usage-tokens']).toBe('VOLATILE');
		expect(out['x-token-count']).toBe('7');
	});

	it('redacts before marking volatile, so a header that is both is not merely marked', () => {
		// Ordering matters: `set-cookie` is volatile AND secret. Marking it volatile first
		// would be a leak wearing a placeholder.
		const out = sanitizeHeaders({ 'set-cookie': `s=${KEY}` }, [KEY]);
		expect(out['set-cookie']).toBe('REDACTED');
	});

	it('flattens headers that change every request, so a re-record diff means something', () => {
		// integrations.md section 6 claims "diffs in recorded responses show provider changes
		// in code review". With cf-ray and date live, the diff is never empty and nobody
		// reads it, which makes the claim false rather than merely noisy.
		const out = sanitizeHeaders(
			{ 'cf-ray': 'a277a708cc69c07d-EWR', date: 'Thu, 07 Aug 2026 16:28:06 GMT' },
			[KEY],
		);
		expect(out['cf-ray']).toBe('VOLATILE');
		expect(out.date).toBe('VOLATILE');
	});

	it('keeps the stable half of a rate-limit pair', () => {
		const out = sanitizeHeaders(
			{ 'x-ratelimit-limit': '20, 20;w=60', 'x-ratelimit-remaining': '19' },
			[KEY],
		);
		expect(out['x-ratelimit-limit']).toBe('20, 20;w=60');
		expect(out['x-ratelimit-remaining']).toBe('VOLATILE');
	});
});

describe('the fixture byte format', () => {
	it('round-trips bytes that are not valid UTF-8', () => {
		// A Shift_JIS page is the motivating case: decode it to a string on the way into a
		// fixture and the mojibake is baked in permanently, and /detect then fingerprints
		// the corruption rather than the page.
		const shiftJis = new Uint8Array([
			0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x3c, 0x2f, 0x62, 0x3e,
		]);
		const b64 = Buffer.from(shiftJis).toString('base64');
		const back = new Uint8Array(Buffer.from(b64, 'base64'));
		expect(back).toEqual(shiftJis);

		// The lossy path, for contrast: this is what storing a string would do.
		const lossy = new Uint8Array(Buffer.from(new TextDecoder().decode(shiftJis), 'utf8'));
		expect(lossy).not.toEqual(shiftJis);
	});
});

describe('the fixture ceiling', () => {
	// The streaming read itself now lives in `@proxlane/shared/transport` and is covered by
	// `transport.e2e.test.ts` — including the POST body this file's caller used to drop. What
	// stays here is the one thing that is the recorder's own: how big a committed fixture may be.
	it('has a cap well under the 10 MB response limit in operations.md section 1', () => {
		// A fixture is read into memory by every contract test and lives in git forever, so
		// its ceiling is its own concern and lower than a live response's.
		expect(MAX_FIXTURE_BYTES).toBeLessThan(10 * 1024 * 1024);
		expect(MAX_FIXTURE_BYTES).toBeGreaterThan(64 * 1024);
	});
});

describe('the target matrix', () => {
	it('covers every category exactly once', () => {
		const cats = TARGETS.map((t) => t.category);
		expect(new Set(cats).size).toBe(cats.length);
		expect(cats.length).toBeGreaterThan(0);
	});

	it('states an expected outcome and a reason for every target', () => {
		for (const t of TARGETS) {
			expect(t.expect, `${t.category} has no expected outcome`).toBeTruthy();
			expect(t.why, `${t.category} has no stated reason`).toBeTruthy();
			expect(t.url).toMatch(/^https:\/\//);
		}
	});

	it('does not pretend to produce block or captcha fixtures', () => {
		// They cannot be summoned from httpbin on demand. A target claiming to would
		// produce a fixture that is really a 200, mislabelled — worse than having none.
		const cats = TARGETS.map((t) => t.category).join(',');
		expect(cats).not.toContain('block');
		expect(cats).not.toContain('captcha');
	});

	it('exercises renderJs, or the capability is never checked', () => {
		expect(TARGETS.some((t) => t.renderJs)).toBe(true);
	});
});

describe('--only is a scope, not a disappearance', () => {
	// EVERY SCHEDULED record:diff WAS RED, from the second pass — the one that exists to check
	// `deadline`, which the first pass cannot record. `--only=deadline` filtered the other
	// categories out before the loop, so they never reached `skipped`, and reportDiff read each
	// as "committed, but this run recorded nothing for it". Eleven fabricated drifts per
	// adapter per week, and that step opens no issue, so it stayed red where nobody looks.

	it('names what it left out, so the diff can tell scope from loss', () => {
		const { selected, deferred } = partitionByOnly(TARGETS, 'deadline');
		expect(selected.map((t) => t.category)).toEqual(['deadline']);
		expect(deferred).not.toContain('deadline');
		expect(deferred.length).toBe(TARGETS.length - 1);
	});

	it('defers nothing on a full run', () => {
		const { selected, deferred } = partitionByOnly(TARGETS, undefined);
		expect(selected).toBe(TARGETS);
		expect(deferred).toEqual([]);
	});

	it('selects nothing for an unknown category, so the CLI can refuse it', () => {
		expect(partitionByOnly(TARGETS, 'no-such-category').selected).toEqual([]);
	});

	// A corpus with three committed fixtures and a fresh run that recorded only `deadline`.
	// With `deferred` the other two are NOT CHECKED and the run passes on the one comparison
	// it made; without it, the same directories are read as two fixtures that stopped
	// recording — the exact output of the 2026-09-09 scheduled run.
	const fixture = (category: string) =>
		JSON.stringify({
			category,
			recordedAt: new Date().toISOString(),
			adapter: 'x',
			expect: 'OK',
			kind: 'exchange',
			response: { status: 200, headers: {}, bodyBase64: '', bodyBytes: 0 },
		});
	const corpus = () => {
		const root = mkdtempSync(join(tmpdir(), 'record-only-'));
		const committed = join(root, 'committed');
		const fresh = join(root, 'fresh');
		mkdirSync(committed);
		mkdirSync(fresh);
		for (const c of ['success-html', 'target-error', 'deadline']) {
			writeFileSync(join(committed, `${c}.json`), fixture(c));
		}
		writeFileSync(join(fresh, 'deadline.json'), fixture('deadline'));
		return { committed, fresh };
	};
	const quiet = () => {
		const out: string[] = [];
		const so = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
			out.push(String(s));
			return true;
		});
		const se = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
			out.push(String(s));
			return true;
		});
		return {
			text: () => out.join(''),
			restore: () => {
				so.mockRestore();
				se.mockRestore();
			},
		};
	};

	it('passes a scoped pass on the one fixture it compared, and says what it did not', () => {
		const { committed, fresh } = corpus();
		const q = quiet();
		try {
			const code = reportDiff('x', committed, fresh, {
				failed: 0,
				skipped: [],
				mismatched: [],
				exhausted: [],
				deferred: ['success-html', 'target-error'],
			});
			expect(code).toBe(0);
			expect(q.text()).toMatch(/1 fixture\(s\) unchanged/);
			expect(q.text()).toMatch(/NOT CHECKED: .*success-html \(outside --only\)/);
			expect(q.text()).not.toMatch(/recorded nothing for it/);
		} finally {
			q.restore();
		}
	});

	it('still reads a genuinely missing recording as drift when nothing was deferred', () => {
		// The guard this fix must not weaken: a category that stopped recording, on a full
		// run, is the fixture most likely to have drifted.
		const { committed, fresh } = corpus();
		const q = quiet();
		try {
			const code = reportDiff('x', committed, fresh, {
				failed: 0,
				skipped: [],
				mismatched: [],
				exhausted: [],
			});
			expect(code).toBe(1);
			expect(q.text()).toMatch(/success-html\.json: committed, but this run recorded nothing/);
		} finally {
			q.restore();
		}
	});
});

describe('the CLI refuses to spend credits by accident', () => {
	it('requires --adapter', () => {
		const { code, out } = run([]);
		expect(code).not.toBe(0);
		expect(out).toContain('Credits do not refund');
	});

	it('rejects an unknown category before touching the network', () => {
		const { code, out } = run(['--adapter=x', '--only=not-a-category']);
		expect(code).not.toBe(0);
		expect(out).toContain('no target category');
	});

	it('fails on an unregistered adapter rather than guessing', () => {
		const { code, out } = run(['--adapter=nope']);
		expect(code).not.toBe(0);
		expect(out).toContain('is not in the registry');
	});
});
