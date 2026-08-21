// A refusal that writes the file anyway.
//
// `record.ts` scanned every finished fixture for identifying fields that survived redaction —
// `client_ip`, our egress address as the provider saw it, which CLAUDE.md bans from this repo
// outright — printed `REFUSING TO WRITE`, incremented `failed`, and then fell straight through
// to `writeFileSync`. The operator was told the fixture had been refused while it was written
// into the tracked fixture directory. One `git add -A` and it is in public history.
//
// The adjacent key check had its `continue`; the field check's was missing because a `continue`
// there would have advanced the FIELD loop rather than the target loop, so the obvious edit
// would not have worked and presumably was not made.
//
// READ FROM SOURCE, AND HERE IS THE LIMIT. Both guards live inside `record.ts`'s
// `import.meta.filename === process.argv[1]` block, which spends provider credits and cannot be
// invoked from a unit test. So this checks the SHAPE the guard must have. The behavioural proof
// is that `pnpm record` has never written a fixture past a refusal since — which nobody can
// assert here.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts');

describe('every REFUSING TO WRITE actually stops', () => {
	const sources = ['record.ts', 'capture-block.ts'].map((f) => ({
		file: f,
		src: readFileSync(join(SCRIPTS, f), 'utf8'),
	}));

	it('has refusals to check', () => {
		// Non-zero denominator. A rename would otherwise turn this into a check of nothing.
		const total = sources.reduce(
			(n, s) => n + [...s.src.matchAll(/REFUSING TO WRITE/g)].length,
			0,
		);
		expect(total, 'no refusal guards found at all').toBeGreaterThan(0);
	});

	for (const { file, src } of sources) {
		it(`${file} follows each refusal with continue, exit or throw`, () => {
			const refusals = [...src.matchAll(/REFUSING TO WRITE/g)];
			expect(refusals.length, `${file} has no refusal`).toBeGreaterThan(0);
			for (const m of refusals) {
				// The 400 characters after the message: enough to cover the stderr write, the
				// counter, and whatever stops the flow. A guard that stops has one of these.
				const after = src.slice(m.index, m.index + 400);
				expect(
					/\b(continue|process\.exit|throw|return)\b/.test(after),
					`${file}: a refusal at offset ${m.index} does not stop — the file is written anyway`,
				).toBe(true);
			}
		});
	}

	it('never reaches writeFileSync before stopping, in record.ts', () => {
		// The specific regression: the field-scan refusal sat above `writeFileSync` in the same
		// block with nothing between them. Asserts no `writeFileSync` appears between a refusal
		// and the thing that stops it.
		const src = sources.find((s) => s.file === 'record.ts')?.src ?? '';
		for (const m of src.matchAll(/REFUSING TO WRITE/g)) {
			const after = src.slice(m.index, m.index + 400);
			const stop = after.search(/\b(continue|process\.exit|throw|return)\b/);
			const write = after.search(/writeFileSync/);
			if (write !== -1) {
				expect(
					stop !== -1 && stop < write,
					`record.ts: a refusal writes the fixture before stopping`,
				).toBe(true);
			}
		}
	});
});
