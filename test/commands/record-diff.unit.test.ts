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

/** A recording pass where everything recorded. Anything else is a separate test below. */
const CLEAN = {
	failed: 0,
	skipped: [] as string[],
	mismatched: [] as string[],
	exhausted: [] as string[],
};

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
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(0);
	});

	it('accepts a header whose value counts down, and notices one that vanishes', () => {
		const headers = { 'content-type': 'application/json', 'x-remaining-credit': '949' };
		write(committed, fixture({ headers }));
		write(
			fresh,
			fixture({ at: daysAgo(0), headers: { ...headers, 'x-remaining-credit': '467' } }),
		);
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(0);

		write(fresh, fixture({ at: daysAgo(0), headers: { 'content-type': 'application/json' } }));
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
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
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(0);
	});
});

describe('a changed shape is drift, and is never silently absorbed', () => {
	it('catches a field that disappeared', () => {
		write(committed, fixture({ body: { result: { content: 'x', status_code: 200 } } }));
		write(fresh, fixture({ at: daysAgo(0), body: { result: { content: 'x' } } }));
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
	});

	it('catches a leaf whose type changed under an unchanged field name', () => {
		// A NUMBER BECOMING A STRING, which is the version of this that a path-set comparison
		// cannot see: `result.status_code` is present either way. Caught by mutation — the
		// earlier case swapped a string for an object, which moves the paths as well, so it
		// passed with leaf types stripped out of the signature entirely.
		write(committed, fixture({ body: { result: { status_code: 200 } } }));
		write(fresh, fixture({ at: daysAgo(0), body: { result: { status_code: '200' } } }));
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
	});

	it('catches a field that appeared, not only one that vanished', () => {
		write(committed, fixture({ body: { result: { content: 'x' } } }));
		write(fresh, fixture({ at: daysAgo(0), body: { result: { content: 'x', warning: 'y' } } }));
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
	});

	it('catches a changed status', () => {
		write(committed, fixture({}));
		write(fresh, fixture({ at: daysAgo(0), status: 429 }));
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
	});

	// THE TEST THAT USED TO SIT HERE ASSERTED THE DECORATION. It hand-set two different `expect`
	// values and checked they were noticed — but a real recording writes `expect` verbatim from
	// the TARGETS matrix on both sides, so the two can never differ in practice. The test passed
	// by constructing a state the recorder cannot produce.
	//
	// The real claim, checked against the real verdict, is in
	// "a response that still records but parses differently is drift" at the end of this file.

	it('leaves the committed fixture exactly as it was when it reports drift', () => {
		// THE MUTATION THAT MATTERS. If renewal ever wrote the fresh FILE rather than its date,
		// the job would overwrite the evidence of the drift it exists to report.
		const before = fixture({ at: daysAgo(90) });
		write(committed, before);
		write(fresh, fixture({ at: daysAgo(0), status: 500 }));
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
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
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(0);
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

		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(0);
		const after = read(committed);
		expect(Date.parse(String(after.recordedAt))).toBeGreaterThan(Date.parse(was));
		expect(after.response).toEqual(before.response);
	});
});

describe('the corpus itself', () => {
	it('reports a category that records now but is absent from the corpus', () => {
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
	});

	it('does not let one unchanged fixture mask a changed one', () => {
		write(committed, fixture({}));
		write(fresh, fixture({ at: daysAgo(0) }));
		writeFileSync(join(committed, 'post.json'), `${JSON.stringify(fixture({}))}\n`);
		writeFileSync(
			join(fresh, 'post.json'),
			`${JSON.stringify(fixture({ at: daysAgo(0), status: 500 }))}\n`,
		);
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
	});

	it('exits 0 for an adapter with no corpus yet, rather than calling every category new', () => {
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(reportDiff('x', join(committed, 'nope'), fresh, CLEAN)).toBe(0);
	});

	it('still reports when the directory exists but is empty', () => {
		const empty = join(committed, 'empty');
		mkdirSync(empty);
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(reportDiff('x', empty, fresh, CLEAN)).toBe(1);
	});
});

describe('a pass that could not record is not a pass', () => {
	// THE HOLE THAT SHIPPED IN THE COMMIT THAT FIXED THE PREVIOUS HOLE. `reportDiff` walked only
	// the fresh directory and never read the recording loop's `failed` counter, so a Wednesday
	// where the provider was unreachable produced an empty temp dir, nothing to compare, and
	// "0 fixture(s) unchanged in shape" — exit 0. Found by an independent review panel, which
	// reproduced it against the real corpus: 11 committed fixtures, none compared, exit 0.
	it('exits 1 when the fresh directory is empty and the corpus is not', () => {
		write(committed, fixture({}));
		writeFileSync(join(committed, 'post.json'), `${JSON.stringify(fixture({}))}\n`);
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
	});

	it('exits 1 when a recording failed, even where every surviving fixture matches', () => {
		// The subtler direction: one category failed, the rest recorded and matched perfectly.
		// Reporting "all unchanged" here is a claim about a fixture nobody looked at.
		write(committed, fixture({}));
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(0);
		expect(
			reportDiff('x', committed, fresh, {
				failed: 1,
				skipped: [],
				mismatched: [],
				exhausted: [],
			}),
		).toBe(1);
	});

	it('reports a committed fixture this run recorded nothing for', () => {
		// Walking only the fresh directory made this invisible — the fixture most likely to have
		// drifted is the one that silently dropped out of the comparison.
		write(committed, fixture({}));
		writeFileSync(join(committed, 'render-js.json'), `${JSON.stringify(fixture({}))}\n`);
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
	});
});

describe('a category that was deliberately skipped is named, not counted as confirmed', () => {
	// `deadline` needs `--timeout-ms` below the target delay, and the weekly job does not pass
	// one — so `deadline.json` was exempt from drift detection every single week while the
	// report called everything else confirmed. Being skipped is acceptable; being silent is not.
	it('does not report a skipped category as drift', () => {
		write(committed, fixture({}));
		writeFileSync(join(committed, 'deadline.json'), `${JSON.stringify(fixture({}))}\n`);
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(
			reportDiff('x', committed, fresh, {
				failed: 0,
				skipped: ['deadline'],
				mismatched: [],
				exhausted: [],
			}),
		).toBe(0);
	});

	it('says so in the output, rather than letting it pass unmentioned', () => {
		const said: string[] = [];
		vi.mocked(process.stdout.write).mockImplementation((c: unknown) => {
			said.push(String(c));
			return true;
		});
		write(committed, fixture({}));
		writeFileSync(join(committed, 'deadline.json'), `${JSON.stringify(fixture({}))}\n`);
		write(fresh, fixture({ at: daysAgo(0) }));
		reportDiff('x', committed, fresh, {
			failed: 0,
			skipped: ['deadline'],
			mismatched: [],
			exhausted: [],
		});
		expect(said.join('')).toContain('NOT CHECKED');
		expect(said.join('')).toContain('deadline');
	});

	it('refuses to call a run clean when EVERY category was skipped', () => {
		// The degenerate case, and the one an empty comparison hides behind: nothing compared,
		// nothing changed, therefore green. An empty comparison is not a clean one.
		writeFileSync(join(committed, 'deadline.json'), `${JSON.stringify(fixture({}))}\n`);
		expect(
			reportDiff('x', committed, fresh, {
				failed: 0,
				skipped: ['deadline'],
				mismatched: [],
				exhausted: [],
			}),
		).toBe(1);
	});
});

describe('a response that still records but parses differently is drift', () => {
	// THE CHECK THAT COULD NOT FIRE. It read `before.expect !== after.expect` — and `expect` is
	// written verbatim from the TARGETS matrix on every recording, so both sides were the same
	// literal from the same constant. Meanwhile the real verdict, `parse()` run over the bytes
	// just recorded, was computed for the console line and thrown away in diff mode.
	//
	// A comparison whose two sides come from one place, inside the command built to prevent
	// exactly that. Found by the review panel, in code written the same day.
	it('reports a category whose fresh recording no longer parses as expected', () => {
		write(committed, fixture({}));
		write(fresh, fixture({ at: daysAgo(0) }));
		// Byte-identical shape, so nothing else can explain the failure.
		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(0);
		expect(
			reportDiff('x', committed, fresh, {
				failed: 0,
				skipped: [],
				mismatched: ['success-html'],
				exhausted: [],
			}),
		).toBe(1);
	});

	it('ignores a mismatch in a category it is not comparing', () => {
		// The other direction: a mismatch elsewhere must not condemn this fixture.
		write(committed, fixture({}));
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(
			reportDiff('x', committed, fresh, {
				failed: 0,
				skipped: [],
				mismatched: ['render-js'],
				exhausted: [],
			}),
		).toBe(0);
	});
});

// AN EMPTY WALLET IS NOT A CHANGED PROVIDER. #266 taught the live canary this and the drift
// detector never heard it. On 2026-09-02 ScraperAPI sat at zero credits, answered 403 to every
// category, and the scheduled job reported that `dead-host` and `target-error` had stopped
// producing TARGET_ERROR and that a `deadline.json` had appeared from nowhere. Nothing had moved
// except the balance.
describe('a spent plan is not provider drift', () => {
	/** Write one named fixture, so a case can have something else left to compare. */
	const put = (dir: string, name: string, o: unknown) =>
		writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(o, null, '\t')}\n`);

	it('excuses the shape change a 403 body makes, without excusing shape changes at large', () => {
		// THE REAL SHAPE OF THE 09-02 FAILURE. An exhausted plan does not return a smaller version
		// of the fixture — it returns a 272-byte error body in place of the recorded one, so every
		// field the committed fixture had is gone and every field the error has is new. That is
		// the largest drift signal the comparison can produce, from the one cause that means
		// nothing. `render-js` compares cleanly and supplies the denominator, so the verdict turns
		// only on how `success-html` is classified.
		put(committed, 'render-js', fixture({}));
		put(fresh, 'render-js', fixture({ at: daysAgo(0) }));
		write(committed, fixture({}));
		write(
			fresh,
			fixture({
				at: daysAgo(0),
				status: 403,
				body: { error: 'You have exhausted the API Credits available in this monthly cycle' },
			}),
		);

		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
		expect(reportDiff('x', committed, fresh, { ...CLEAN, exhausted: ['success-html'] })).toBe(
			0,
		);
	});

	it('does not invent a fixture that appeared, when the run could not pay for it', () => {
		// The `deadline.json: recorded now, absent from the corpus` line from the real failure.
		write(committed, fixture({}));
		write(fresh, fixture({ at: daysAgo(0) }));
		put(fresh, 'deadline', fixture({}));

		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
		expect(reportDiff('x', committed, fresh, { ...CLEAN, exhausted: ['deadline'] })).toBe(0);
	});

	it('does not call a fixture missing, when the run could not pay to record it', () => {
		// The other half, and the one that produced two of the three lines on 09-02: committed,
		// but this run recorded nothing for it.
		put(committed, 'render-js', fixture({}));
		put(fresh, 'render-js', fixture({ at: daysAgo(0) }));
		write(committed, fixture({}));

		expect(reportDiff('x', committed, fresh, CLEAN)).toBe(1);
		expect(reportDiff('x', committed, fresh, { ...CLEAN, exhausted: ['success-html'] })).toBe(
			0,
		);
	});

	it('still refuses to call a wholly unpaid run clean', () => {
		// THE LINE THAT MATTERS, and the reason the two cases above need a second fixture at all.
		// Excusing an empty wallet must not become a way to pass without comparing anything: the
		// zero-denominator rule outranks it. Every category exhausted is not a green week, it is
		// a week with no evidence, and it exits 1.
		write(committed, fixture({}));
		write(fresh, fixture({ at: daysAgo(0) }));
		expect(reportDiff('x', committed, fresh, { ...CLEAN, exhausted: ['success-html'] })).toBe(
			1,
		);
	});
});
