// `pnpm record --diff`, and the one judgement inside it: what counts as drift.
//
// THIS COMMAND WAS IN A CRON BEFORE IT EXISTED. `scheduled.yml` ran
// `pnpm record --diff || echo "::notice::record is a stub"` every Wednesday, and `--diff` appeared
// nowhere in `scripts/record.ts` — so it exited 2 on the missing `--adapter`, the `|| echo`
// swallowed that, and the drift detector reported success weekly without comparing anything. The
// job also had no provider keys, so it could not have worked even if the flag had existed.
//
// THE FIRST IMPLEMENTATION COMPARED BYTES AND WAS WRONG. A real Scrapfly re-recording of the same
// URL differed in 15 of 141 body fields, all of them volatile by design: the request uuid, two
// timestamps, the duration, and a rotated browser and proxy fingerprint. That rotation is the
// product working. So the comparison is over SHAPE — which fields exist and what type they hold —
// because that is what `parse()` depends on and what a provider changing its API would break.
//
// Recording spends credits and needs keys; deciding what a fresh recording MEANS does not, and
// that is the half worth pinning.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RENEW_AFTER_DAYS, reportDiff } from '../../scripts/record.ts';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** A fixture as `record.ts` writes one. */
function fixture(opts: {
	at?: string;
	body?: unknown;
	headers?: Record<string, string>;
	status?: number;
	expect?: string;
}) {
	return {
		category: 'success-html',
		recordedAt: opts.at ?? daysAgo(3),
		adapter: 'x',
		expect: opts.expect ?? 'OK',
		response: {
			status: opts.status ?? 200,
			headers: opts.headers ?? { 'content-type': 'application/json' },
			bodyBase64: b64(opts.body ?? { result: { content: '<html/>', status_code: 200 } }),
		},
	};
}

let committed: string;
let fresh: string;

beforeEach(() => {
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	committed = mkdtempSync(join(tmpdir(), 'committed-'));
	fresh = mkdtempSync(join(tmpdir(), 'fresh-'));
});

const write = (dir: string, o: unknown) =>
	writeFileSync(join(dir, 'success-html.json'), `${JSON.stringify(o, null, '\t')}\n`);
const read = (dir: string) =>
	JSON.parse(readFileSync(join(dir, 'success-html.json'), 'utf8')) as Record<string, unknown>;

describe('rotating values are not drift', () => {
	it('accepts a body whose every value changed but whose shape did not', () => {
		// THE CASE THAT KILLED THE BYTE COMPARISON, in miniature: same fields, all new values.
		write(committed, fixture({ body: { uuid: 'a', os: 'windows', duration: 0.99 } }));
		write(fresh, fixture({ at: daysAgo(0), body: { uuid: 'b', os: 'mac', duration: 1.55 } }));
		expect(reportDiff('x', committed, fresh)).toBe(0);
	});

	it('accepts a header whose value counts down, and notices one that vanishes', () => {
		const headers = { 'content-type': 'application/json', 'x-remaining-credit': '949' };
		write(committed, fixture({ headers }));
		write(
			fresh,
			fixture({ at: daysAgo(0), headers: { ...headers, 'x-remaining-credit': '467' } }),
		);
		expect(reportDiff('x', committed, fresh)).toBe(0);

		write(fresh, fixture({ at: daysAgo(0), headers: { 'content-type': 'application/json' } }));
		expect(reportDiff('x', committed, fresh)).toBe(1);
	});

	it('treats a non-JSON body as opaque, because the web changes and that is not news', () => {
		const html = (s: string) => ({
			...fixture({}),
			response: {
				status: 200,
				headers: { 'content-type': 'text/html' },
				bodyBase64: Buffer.from(s, 'utf8').toString('base64'),
			},
		});
		write(committed, html('<html>monday</html>'));
		write(fresh, { ...html('<html>friday, quite different</html>'), recordedAt: daysAgo(0) });
		expect(reportDiff('x', committed, fresh)).toBe(0);
	});
});

describe('a changed shape is drift, and is never silently absorbed', () => {
	it('catches a field that disappeared', () => {
		write(committed, fixture({ body: { result: { content: 'x', status_code: 200 } } }));
		write(fresh, fixture({ at: daysAgo(0), body: { result: { content: 'x' } } }));
		expect(reportDiff('x', committed, fresh)).toBe(1);
	});

	it('catches a leaf whose type changed under an unchanged field name', () => {
		// A NUMBER BECOMING A STRING, which is the version of this that a path-set comparison
		// cannot see: `result.status_code` is present either way. Caught by mutation — the
		// earlier case swapped a string for an object, which moves the paths as well, so it
		// passed with leaf types stripped out of the signature entirely.
		write(committed, fixture({ body: { result: { status_code: 200 } } }));
		write(fresh, fixture({ at: daysAgo(0), body: { result: { status_code: '200' } } }));
		expect(reportDiff('x', committed, fresh)).toBe(1);
	});

	it('catches a field that appeared, not only one that vanished', () => {
		write(committed, fixture({ body: { result: { content: 'x' } } }));
		write(fresh, fixture({ at: daysAgo(0), body: { result: { content: 'x', warning: 'y' } } }));
		expect(reportDiff('x', committed, fresh)).toBe(1);
	});

	it('catches a changed status', () => {
		write(committed, fixture({}));
		write(fresh, fixture({ at: daysAgo(0), status: 429 }));
		expect(reportDiff('x', committed, fresh)).toBe(1);
	});

	it('catches the same shape parsing to a different outcome', () => {
		// The most consequential drift there is: nothing about the envelope moved, but what the
		// adapter concludes from it did.
		write(committed, fixture({ expect: 'OK' }));
		write(fresh, fixture({ at: daysAgo(0), expect: 'SOFT_BLOCK' }));
		expect(reportDiff('x', committed, fresh)).toBe(1);
	});

	it('leaves the committed fixture exactly as it was when it reports drift', () => {
		// THE MUTATION THAT MATTERS. If renewal ever wrote the fresh FILE rather than its date,
		// the job would overwrite the evidence of the drift it exists to report.
		const before = fixture({ at: daysAgo(90) });
		write(committed, before);
		write(fresh, fixture({ at: daysAgo(0), status: 500 }));
		expect(reportDiff('x', committed, fresh)).toBe(1);
		expect(read(committed)).toEqual(before);
	});
});

describe('an unchanged shape confirms a fixture rather than churning it', () => {
	it('leaves a recently-dated fixture alone', () => {
		// Renewing every date every week produces a weekly pull request of nothing but
		// timestamps, which is how a reviewer learns to approve this job's diffs without reading.
		const was = daysAgo(3);
		write(committed, fixture({ at: was }));
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(reportDiff('x', committed, fresh)).toBe(0);
		expect(read(committed).recordedAt).toBe(was);
	});

	it('renews a stale date and stamps ONLY the date', () => {
		// THE POINT OF THE EXERCISE. Without it a freshness rule is a re-record treadmill; with
		// it, an old date means re-recording is failing or has never run.
		//
		// THE FRESH BODY CARRIES DIFFERENT VALUES ON PURPOSE — a rotated fingerprint, as a real
		// re-recording does. An earlier version of this test made the two bodies identical, so
		// replacing the renewal with `Object.assign(before, after)` was undetectable; the corpus
		// could have been quietly rewritten every 30 days with a differently-fingerprinted
		// recording and nothing would have said so. Caught by mutation.
		const was = daysAgo(RENEW_AFTER_DAYS + 5);
		const before = fixture({ at: was, body: { uuid: 'a', os: 'windows' } });
		write(committed, before);
		write(fresh, fixture({ at: daysAgo(0), body: { uuid: 'b', os: 'mac' } }));

		expect(reportDiff('x', committed, fresh)).toBe(0);
		const after = read(committed);
		expect(Date.parse(String(after.recordedAt))).toBeGreaterThan(Date.parse(was));
		expect(after.response).toEqual(before.response);
	});
});

describe('the corpus itself', () => {
	it('reports a category that records now but is absent from the corpus', () => {
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(reportDiff('x', committed, fresh)).toBe(1);
	});

	it('does not let one unchanged fixture mask a changed one', () => {
		write(committed, fixture({}));
		write(fresh, fixture({ at: daysAgo(0) }));
		writeFileSync(join(committed, 'post.json'), `${JSON.stringify(fixture({}))}\n`);
		writeFileSync(
			join(fresh, 'post.json'),
			`${JSON.stringify(fixture({ at: daysAgo(0), status: 500 }))}\n`,
		);
		expect(reportDiff('x', committed, fresh)).toBe(1);
	});

	it('exits 0 for an adapter with no corpus yet, rather than calling every category new', () => {
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(reportDiff('x', join(committed, 'nope'), fresh)).toBe(0);
	});

	it('still reports when the directory exists but is empty', () => {
		const empty = join(committed, 'empty');
		mkdirSync(empty);
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(reportDiff('x', empty, fresh)).toBe(1);
	});
});
