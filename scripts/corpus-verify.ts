// `pnpm corpus:verify` — run every stored block capture through the detector, and write down
// which rules a real page has actually confirmed.
//
// WHAT THIS REPLACES is a boolean. `DetectRule.verifiedAgainstRealCapture` was hand-set, false on
// all six rules, and nothing stopped anyone typing `true`. The site reads that field and prints
// "no real capture yet" beside each rule, so the most load-bearing honesty claim in the product
// was a value somebody could edit in one keystroke with no capture behind it.
//
// It is derived now. A rule appears in the generated table only if a stored capture, run through
// the real `detect()`, fired that exact rule — and the table records the capture's SHA-256, so
// the claim points at a specific artefact rather than at a memory.
//
// THE CORPUS IS MOSTLY PRIVATE AND THAT IS THE POINT. `plan.md` section 19 keeps captures of
// named targets out of this repository, so CI cannot regenerate this file and must not try. What
// is committed is the table: rule, count, target CLASSES, date, digests. No bodies, no hostnames.
// Section 19 asks for "classes of target, never names", which is exactly what a manifest is.
//
// So the check in `repo:check` is deliberately the weaker one — that the table names only real
// rules and cites a digest for every claim — and this command is what a maintainer with the
// corpus runs to move it. Same shape as the cost tables: the artefact cannot be verified in CI,
// so the discipline is provenance rather than recomputation.
//
// Run:  pnpm corpus:verify            (checks the committed table is current)
//       pnpm corpus:verify --write    (regenerates it)

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The BUILT detector, not the source. `index.ts` imports `./verified.js`, which Node's type
// stripping will not resolve to a `.ts` file, and this script must run the same code the gateway
// runs anyway. `conformance` builds first for the same reason; the npm script does the build.
import { detect, RULES } from '../packages/detect/dist/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_CORPUS = join(ROOT, 'packages/detect/corpus');
const OUT = join(ROOT, 'packages/detect/src/verified.ts');

interface Capture {
	readonly kind?: string;
	readonly rule: string;
	readonly targetClass: string;
	readonly capturedAt: string;
	readonly contentType?: string;
	readonly bodyBase64: string;
}

interface Verified {
	captures: number;
	classes: string[];
	lastVerified: string;
	digests: string[];
}

/** Every capture visible to this machine: the committed half, plus the private one if set. */
function corpusDirs(): string[] {
	const priv = process.env.PROXLANE_PRIVATE_CORPUS;
	return [
		PUBLIC_CORPUS,
		...(priv !== undefined && priv.trim() !== '' ? [priv.trim()] : []),
	].filter((d) => existsSync(d));
}

function load(dir: string): { file: string; capture: Capture }[] {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => ({ file: join(dir, f), raw: readFileSync(join(dir, f), 'utf8') }))
		.map(({ file, raw }) => ({ file, capture: JSON.parse(raw) as Capture }))
		.filter(({ capture }) => capture.kind === 'block-capture');
}

export function verify(dirs: readonly string[]): {
	table: Record<string, Verified>;
	mismatches: string[];
	seen: number;
} {
	const table: Record<string, Verified> = {};
	const mismatches: string[] = [];
	let seen = 0;

	for (const dir of dirs) {
		for (const { file, capture } of load(dir)) {
			seen += 1;
			const bytes = Buffer.from(capture.bodyBase64, 'base64');
			const v = detect(new Uint8Array(bytes), capture.contentType, 'utf-8');
			const name = file.split('/').pop() ?? file;

			if (capture.rule === 'none') {
				// A no-fire sample. It must NOT be called a block, and it verifies nothing.
				if (v.blocked) {
					mismatches.push(
						`${name}: stored as a no-fire sample but ${v.ruleId} fired on it. Either the ` +
							'capture is mislabelled or that rule has a false positive.',
					);
				}
				continue;
			}

			if (!v.blocked || v.ruleId !== capture.rule) {
				mismatches.push(
					`${name}: stored as ${capture.rule} but the detector said ` +
						`${v.blocked ? v.ruleId : 'not blocked'}. A capture that does not fire its own ` +
						'rule verifies nothing.',
				);
				continue;
			}

			table[capture.rule] ??= {
				captures: 0,
				classes: [],
				lastVerified: capture.capturedAt.slice(0, 10),
				digests: [],
			};
			const e = table[capture.rule] as Verified;
			e.captures += 1;
			if (!e.classes.includes(capture.targetClass)) e.classes.push(capture.targetClass);
			const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
			if (!e.digests.includes(digest)) e.digests.push(digest);
			const day = capture.capturedAt.slice(0, 10);
			if (day > e.lastVerified) e.lastVerified = day;
		}
	}

	for (const e of Object.values(table)) {
		e.classes.sort();
		e.digests.sort();
	}
	return { table, mismatches, seen };
}

/**
 * Claims the committed table makes that a regeneration would drop.
 *
 * Parsed from the file's own text rather than imported, because the point is to compare against
 * what is COMMITTED, and importing would read whatever a previous half-finished run left behind.
 */
export function retractions(currentText: string, next: Record<string, Verified>): string[] {
	const gone: string[] = [];
	for (const m of currentText.matchAll(/^\t'?([a-z0-9-]+)'?: \{\n\t\tcaptures: (\d+),/gm)) {
		const id = m[1] as string;
		const was = Number(m[2]);
		const now = next[id];
		if (now === undefined) {
			gone.push(`${id} (${was} capture(s) -> none)`);
		} else if (now.captures < was) {
			gone.push(`${id} (${was} capture(s) -> ${now.captures})`);
		}
	}
	return gone;
}

/** The committed artefact. Sorted, so regenerating twice produces the same bytes. */
export function render(table: Record<string, Verified>): string {
	const ids = Object.keys(table).sort();
	const body = ids
		.map((id) => {
			const e = table[id] as Verified;
			return (
				`\t'${id}': {\n` +
				`\t\tcaptures: ${e.captures},\n` +
				`\t\tclasses: [${e.classes.map((c) => `'${c}'`).join(', ')}],\n` +
				`\t\tlastVerified: '${e.lastVerified}',\n` +
				`\t\tdigests: [${e.digests.map((d) => `'${d}'`).join(', ')}],\n` +
				'\t},'
			);
		})
		.join('\n');

	return `// GENERATED by \`pnpm corpus:verify\`. Do not edit by hand.
//
// Which detection rules a REAL captured block page has confirmed, and what proves it.
//
// This used to be a boolean on each rule. It was false on all six, which was honest, and it was
// also a value anyone could set to true with no capture behind it — while the website read it and
// printed "no real capture yet" to visitors. A claim that load-bearing should not be typeable.
//
// A rule appears here only because a stored capture, run through the real \`detect()\`, fired that
// exact rule. \`digests\` are SHA-256 prefixes of the captured bytes, so each claim names an
// artefact. \`classes\` are kinds of target, never hostnames — \`plan.md\` section 19.
//
// The captures themselves are mostly NOT in this repository, for the same reason. CI cannot
// regenerate this file and does not try; \`repo:check\` holds it to naming real rules and citing a
// digest for every claim, and a maintainer with the corpus runs \`pnpm corpus:verify --write\`.

export interface VerifiedRule {
	/** How many stored captures fired this rule. */
	readonly captures: number;
	/** Kinds of target it was seen on. Never a hostname. */
	readonly classes: readonly string[];
	readonly lastVerified: string;
	/** SHA-256 prefixes of the captured bytes, so the claim points at an artefact. */
	readonly digests: readonly string[];
}

export const VERIFIED: Readonly<Record<string, VerifiedRule>> = {
${body}
};
`;
}

// ---------------------------------------------------------------- cli

if (import.meta.filename === process.argv[1]) {
	const write = process.argv.includes('--write');
	const dirs = corpusDirs();
	const { table, mismatches, seen } = verify(dirs);

	const hasPrivate =
		process.env.PROXLANE_PRIVATE_CORPUS !== undefined &&
		process.env.PROXLANE_PRIVATE_CORPUS.trim() !== '';

	if (mismatches.length > 0) {
		process.stderr.write('\n  corpus:verify — a capture disagrees with the detector\n\n');
		for (const m of mismatches) process.stderr.write(`    ${m}\n`);
		process.stderr.write('\n');
		process.exit(1);
	}

	const next = render(table);
	const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';

	if (write) {
		if (!hasPrivate) {
			// Regenerating with only the public half would silently DELETE every claim backed by a
			// private capture. Refusing is the difference between "not verified" and "unverifiable
			// from here", which is the whole distinction this file exists to keep.
			process.stderr.write(
				'\n  refusing to --write without PROXLANE_PRIVATE_CORPUS: the private captures back ' +
					'most of the table, and regenerating without them would quietly retract those claims.\n\n',
			);
			process.exit(1);
		}
		// AND REFUSE TO RETRACT, which the check above does not cover.
		//
		// That guard fires only when the private corpus is ENTIRELY absent. A corpus that is
		// merely INCOMPLETE — one machine holding one of six captures — sailed through it and
		// regenerated the table from what was mounted, silently deleting five verified rules.
		// Measured: pointing this at a directory with a single capture rewrote a 5-rule table
		// down to 1, exit 0, no warning. The website reads this file and prints "no real capture
		// yet", so the visible result is the project retracting true claims about itself.
		//
		// The existing comment already states the intent — "the difference between 'not verified'
		// and 'unverifiable from here'" — so this is that sentence enforced rather than written.
		const dropped = retractions(current, table);
		if (dropped.length > 0 && !process.argv.includes('--allow-retractions')) {
			process.stderr.write(
				`\n  refusing to --write: this would retract ${dropped.length} claim(s) that the ` +
					'committed table makes.\n\n' +
					dropped.map((d) => `    ${d}\n`).join('') +
					'\n  Your corpus is probably incomplete rather than the claims being wrong. Mount ' +
					'the full\n  private corpus and run again, or pass --allow-retractions if a claim ' +
					'is genuinely being\n  withdrawn.\n\n',
			);
			process.exit(1);
		}
		writeFileSync(OUT, next);
		process.stdout.write(
			`\n  wrote ${OUT.replace(`${ROOT}/`, '')} — ` +
				`${Object.keys(table).length}/${RULES.length} rules verified from ${seen} capture(s)\n\n`,
		);
		process.exit(0);
	}

	if (!hasPrivate) {
		// The normal CI case. Nothing to compare against, and saying so is the honest report.
		process.stdout.write(
			`\n  corpus:verify — ${seen} public capture(s) checked, no private corpus on this machine.\n` +
				`  ${Object.keys(JSON.parse(JSON.stringify(table))).length} rule(s) firing here; the ` +
				'committed table is not regenerated without PROXLANE_PRIVATE_CORPUS.\n\n',
		);
		process.exit(0);
	}

	if (next !== current) {
		process.stderr.write(
			'\n  corpus:verify — the committed table is stale. Run `pnpm corpus:verify --write`.\n\n',
		);
		process.exit(1);
	}
	process.stdout.write(
		`\n  corpus:verify — current. ${Object.keys(table).length}/${RULES.length} rules verified ` +
			`from ${seen} capture(s).\n\n`,
	);
}
