// Generated pages, against the taxonomy they are generated from.
//
// WHAT GOES WRONG WITHOUT THIS, and it has gone wrong twice already in this repo: two code
// paths read the same source and drift. The README's provider table said `planned` for four
// shipped adapters. The landing page counted the providers correctly and listed them in the
// wrong order. Neither had a symptom. A page that is never crawled has no symptom either,
// which is assertion 7's founding lesson: seven docs pages shipped while `sitemap.xml` listed
// one URL, and everything worked.
//
// So the shape here is the same one that worked there. `enumerateSite()` is the single
// enumeration every writer calls, and these assertions are the backstop for when that
// discipline slips rather than the primary defence.
//
// TWO OF THESE ENFORCE A GATE RATHER THAN A FACT, which is unusual and deliberate. `plan.md`
// section 19 bars naming commercial scraping targets, and section 18 gates keyless paths on
// provider permission and counsel. Both are blocked on answers nobody has yet, so the check
// that matters is that they STAY blocked while somebody is busy shipping pages.
//
// Run:  pnpm pages:check

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateSite, outcomeSlug } from '../apps/web/src/generators/site.ts';
import { OUTCOMES } from '../packages/shared/src/outcome.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP = join(ROOT, 'apps/web/public/sitemap.xml');
const WEB_ROUTES = join(ROOT, 'apps/web/src/routes');

const failures: string[] = [];
const notes: string[] = [];
let checked = 0;

const fail = (id: string, detail: string): void => void failures.push(`  [${id}] ${detail}`);
const ok = (id: string, n: number, what: string): void => {
	checked += n;
	notes.push(`  ok  ${id.padEnd(3)} ${String(n).padStart(4)} ${what}`);
};

const pages = enumerateSite();
const sitemap = existsSync(SITEMAP) ? readFileSync(SITEMAP, 'utf8') : '';

// A check with nothing to check is not a pass. Same rule as every other command here.
if (pages.length === 0) {
	process.stderr.write(
		'\n  enumerateSite() returned nothing — this check stopped checking\n\n',
	);
	process.exit(1);
}

// ------------------------------------------------- 1. exhaustive against the closed enum
//
// `OUTCOMES` is closed and exhaustive by construction, so this is really asking whether the
// generator still reads it. A generator that quietly enumerates a subset produces a site that
// looks complete.
{
	const generated = new Set(
		pages.filter((p) => p.path.startsWith('/outcomes/')).map((p) => p.path),
	);
	for (const o of OUTCOMES) {
		const want = `/outcomes/${outcomeSlug(o)}`;
		if (!generated.has(want)) fail('1', `${o} has no page. Expected ${want}.`);
	}
	for (const path of generated) {
		const slug = path.slice('/outcomes/'.length);
		if (!OUTCOMES.some((o) => outcomeSlug(o) === slug)) {
			fail(
				'1',
				`${path} is generated but matches no outcome. A page for something that cannot happen.`,
			);
		}
	}
	ok('1', OUTCOMES.length, 'outcomes each have exactly one page');
}

// ------------------------------------------------------ 2. the sitemap is exactly the set
//
// Both directions. A missing row is a page nobody finds; an extra row is a 404 advertised to
// every crawler that reads it.
{
	const listed = new Set(
		[...sitemap.matchAll(/<loc>https:\/\/proxlane\.dev(\/outcomes\/[a-z0-9-]+)<\/loc>/g)].map(
			(m) => m[1] as string,
		),
	);
	if (sitemap === '') fail('2', 'apps/web/public/sitemap.xml is missing');
	for (const p of pages) {
		if (!listed.has(p.path))
			fail('2', `${p.path} is generated and not in the sitemap, so nothing will crawl it.`);
	}
	for (const l of listed) {
		if (!pages.some((p) => p.path === l))
			fail('2', `the sitemap advertises ${l}, which is not generated.`);
	}
	ok('2', pages.length, 'generated pages are in the sitemap, and nothing else is');
}

// ------------------------------------------------------------- 3. a route actually serves
//
// The sitemap can be perfect and every URL still 404. One dynamic route covers the family, so
// this checks it exists rather than checking eighteen files.
{
	const route = join(WEB_ROUTES, 'outcomes', '$slug.tsx');
	if (!existsSync(route)) {
		fail('3', 'apps/web/src/routes/outcomes/$slug.tsx is missing, so every generated URL 404s');
	} else {
		const src = readFileSync(route, 'utf8');
		// It must resolve the slug through the generator rather than its own copy of the mapping,
		// or the route and the sitemap can disagree about what exists.
		if (!src.includes('outcomeFromSlug')) {
			fail(
				'3',
				'the route does not resolve slugs through the generator, so the two can disagree',
			);
		}
		ok('3', 1, 'a route serves the generated family');
	}
}

// --------------------------------------------- 4. the §19 gate holds: no named targets
//
// `plan.md` section 19's interim default bars naming commercial scraping targets. A generated
// `/targets/**` family is the obvious growth play and the one that must not ship: it would be
// dated, self-published, permanent evidence of running automated access against named sites.
{
	const targets = join(WEB_ROUTES, 'targets');
	if (existsSync(targets)) {
		fail(
			'4',
			'apps/web/src/routes/targets exists. plan.md section 19 bars naming commercial targets.',
		);
	}
	if (/\/targets\//.test(sitemap)) fail('4', 'the sitemap advertises a /targets/ URL.');
	ok('4', 1, 'no target pages, per the section 19 interim default');
}

// ------------------------------------ 5. the §18 gate holds: nothing links to a keyless path
//
// `npx proxlane try`, the blocked-domain checker and the playground are gated on provider
// permission in writing and Swedish counsel. Linking to one from a generated page ships the
// promise before the permission.
{
	const GATED = ['/try', '/playground', '/check'];
	let scanned = 0;
	const walk = (dir: string): void => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.tsx')) {
				const src = readFileSync(full, 'utf8');
				scanned += 1;
				for (const g of GATED) {
					if (src.includes(`href="${g}"`)) {
						fail(
							'5',
							`${entry.name} links to ${g}, which plan.md section 18 gates on counsel.`,
						);
					}
				}
			}
		}
	};
	walk(join(WEB_ROUTES, 'outcomes'));
	if (scanned === 0) fail('5', 'scanned no generated routes — this check stopped checking');
	else ok('5', scanned, 'generated routes link to nothing that is still gated');
}

// ---------------------------------------------------------- 6. every page says something
//
// A generated page with an empty summary is a page that ranks for a string and then tells the
// reader nothing, which is worse than not existing.
{
	for (const p of pages) {
		if (p.summary.trim() === '') fail('6', `${p.path} has an empty summary`);
		if (p.title.trim() === '') fail('6', `${p.path} has an empty title`);
		if (p.summary.includes('undefined')) fail('6', `${p.path} summary contains "undefined"`);
	}
	ok('6', pages.length, 'generated pages carry a title and an answer');
}

// -------------------------------------------------------------------------- report
const out = failures.length ? process.stderr : process.stdout;
out.write(`\npages:check — ${checked} items across ${notes.length} assertions\n\n`);
out.write(`${notes.join('\n')}\n`);
if (failures.length > 0) {
	out.write(`\n${failures.length} FAILURE(S):\n${failures.join('\n')}\n\n`);
	process.exit(1);
}
out.write('\nall generated pages pass\n\n');
