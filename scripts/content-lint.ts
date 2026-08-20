// Symptom pages, against the checklist `operating.md` A4 already wrote for them.
//
// WHY THESE PAGES NEED THEIR OWN CHECK AT ALL. Docs pages get four guarantees from
// `docs:check`: a markdown file, a route, a nav entry, an `llms.txt` line and a sitemap row.
// Symptom pages live outside `/docs` deliberately, so they inherit none of it. That was a real
// decision with a mechanical reason, and the consequence is this file.
//
// The reason: `docs-check.ts` reads `routes/docs` with `readdirSync`, which does not recurse,
// and its `llms.txt` pattern matches a single path segment. Nest a page at
// `/docs/symptoms/foo` and it inherits the docs shell and the reader's fair assumption that
// everything under `/docs` is checked, while passing four assertions without covering
// anything. That is assertion 7's founding failure repeated on purpose.
//
// WHAT IT IS ACTUALLY FOR. A symptom page is read by someone who arrived from a search engine
// twenty minutes into an incident, has never heard of this project, and will leave the moment
// it starts selling. Most of what follows is a mechanical version of that sentence.
//
// Run:  pnpm content:lint

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'apps/web/content/symptoms');
const ROUTES = join(ROOT, 'apps/web/src/routes/symptoms');
const SITEMAP = join(ROOT, 'apps/web/public/sitemap.xml');
const LLMS = join(ROOT, 'apps/web/public/llms.txt');
const DOC_ROUTES = join(ROOT, 'apps/web/src/routes/docs');

const failures: string[] = [];
const notes: string[] = [];
let checked = 0;

function fail(page: string, detail: string): void {
	failures.push(`  [${page}] ${detail}`);
}
function ok(n: number, what: string): void {
	checked += n;
	notes.push(`  ok  ${String(n).padStart(4)} ${what}`);
}

interface Page {
	readonly slug: string;
	readonly meta: Record<string, string>;
	readonly body: string;
}

function read(): Page[] {
	if (!existsSync(CONTENT)) return [];
	return readdirSync(CONTENT)
		.filter((f) => f.endsWith('.md'))
		.sort()
		.map((f) => {
			const src = readFileSync(join(CONTENT, f), 'utf8');
			const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
			const meta: Record<string, string> = {};
			for (const line of (m?.[1] ?? '').split('\n')) {
				const kv = /^([a-z]+):\s*(.+)$/.exec(line.trim());
				if (kv?.[1] !== undefined && kv[2] !== undefined) meta[kv[1]] = kv[2].trim();
			}
			return { slug: f.replace(/\.md$/, ''), meta, body: src.slice(m?.[0].length ?? 0) };
		});
}

const pages = read();

// A CHECK WITH NOTHING TO CHECK IS NOT A PASS. The manifest's own gate text for this command
// said so before it existed, and it is the rule the whole assertion set in this repo runs on.
if (pages.length === 0) {
	process.stderr.write(
		'\n  no symptom pages found in apps/web/content/symptoms\n\n' +
			'  A lint with an empty denominator reports success and means nothing.\n\n',
	);
	process.exit(1);
}

// ---------------------------------------------------------------- 1. one clear query
//
// `operating.md` A4 item 3: "one clear query". A symptom page is named for what somebody typed
// while their scraper was broken, and a page without that recorded is a docs page that wandered
// into the wrong directory.
for (const p of pages) {
	const q = p.meta.query;
	if (q === undefined || q === '') {
		fail(
			p.slug,
			'no `query` in frontmatter. A symptom page is defined by the query it answers.',
		);
		continue;
	}
	if (q.toLowerCase() === (p.meta.title ?? '').toLowerCase()) {
		fail(
			p.slug,
			'`query` and `title` are the same string. The title is our words for the problem, the ' +
				'query is theirs; if they match, one of them is wrong.',
		);
	}
	if (/^[A-Z]/.test(q) && !/^[A-Z]{2,}/.test(q)) {
		fail(p.slug, `\`query\` is "${q}". Nobody capitalises a search box.`);
	}
}
ok(pages.length, 'pages record the query they answer');

// ------------------------------------------------- 2. the answer is above the explanation
//
// THE ANTI-PATTERN THIS FAMILY IS MOST LIKELY TO COMMIT, and it is not a signup wall, which
// this project cannot build. It is burying the answer under positioning while wearing technical
// costume: a well-argued tour of the mechanism with the reader's question answered in paragraph
// four. The landing page already did it, seven sections deep.
//
// Mechanically: the `summary` renders as the answer, directly under the heading and above the
// body. So it must read as an answer to the reader's problem rather than an introduction to
// ours. Naming the product in the first words is the tell.
for (const p of pages) {
	const s = p.meta.summary ?? '';
	if (s === '') {
		fail(p.slug, 'no `summary`. It renders as the answer, so a page without one has none.');
		continue;
	}
	if (/^prox/i.test(s)) {
		fail(
			p.slug,
			`the answer opens with the product name: "${s.slice(0, 48)}...". The first thing a ` +
				'reader sees should be about their request, not about our software.',
		);
	}
	// A first line of body copy that is a heading means the page starts by organising itself
	// rather than by answering.
	if (p.body.trimStart().startsWith('#')) {
		fail(
			p.slug,
			'the body opens with a heading. Answer first, then structure the explanation.',
		);
	}
}
ok(pages.length, 'pages answer before they explain');

// -------------------------------------------------- 3. internal links, and they resolve
//
// `operating.md` A4: "internal links to two related pages". A symptom page that links nowhere
// is a dead end for a reader who now trusts us slightly, which is the moment to be useful.
//
// Resolution is checked against the routes on disk rather than a list, so a link cannot rot
// quietly when a page is renamed.
const docRoutes = existsSync(DOC_ROUTES)
	? new Set(
			readdirSync(DOC_ROUTES)
				.filter((f) => f.endsWith('.tsx'))
				.map((f) => `/docs/${f.replace(/\.tsx$/, '')}`),
		)
	: new Set<string>();
const symptomRoutes = new Set(pages.map((p) => `/symptoms/${p.slug}`));
const known = new Set([...docRoutes, ...symptomRoutes, '/docs', '/symptoms', '/']);

let links = 0;
for (const p of pages) {
	const hrefs = [...p.body.matchAll(/\]\((\/[a-z0-9/-]*)(#[a-z0-9-]+)?\)/g)].map(
		(m) => m[1] as string,
	);
	const internal = [...new Set(hrefs)];
	if (internal.length < 2) {
		fail(
			p.slug,
			`links to ${internal.length} internal page(s); A4 asks for two. A reader who got their ` +
				'answer is the likeliest person to read a second page.',
		);
	}
	for (const href of internal) {
		if (!known.has(href)) {
			fail(
				p.slug,
				`links to ${href}, which is not a route. Check ${DOC_ROUTES} for the real one.`,
			);
		}
	}
	links += internal.length;
}
ok(links, 'internal links resolve to routes that exist');

// ------------------------------------------------------- 4. no undisclosed commercial link
//
// A4: "disclosure if links are present". No affiliate link exists yet, because no affiliate
// term is signed, so the honest check today is that none has appeared without the disclosure
// arriving alongside it. `CLAUDE.md` bans the rate from the repo outright; this bans the link
// from arriving silently.
for (const p of pages) {
	for (const m of p.body.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) {
		const url = m[1] as string;
		if (/[?&](ref|aff|affiliate|utm_source=proxlane)=/i.test(url)) {
			fail(
				p.slug,
				`carries what looks like a tracked commercial link (${url}) with no disclosure.`,
			);
		}
	}
}
ok(pages.length, 'pages carry no undisclosed commercial link');

// ------------------------------------------ 5. the four-way guarantee, rebuilt not inherited
//
// Docs pages get this from `docs:check`. These do not, because they deliberately live outside
// `/docs`, so it is rebuilt here: a page must have a route, a sitemap row and an `llms.txt`
// line. Miss one and the page works perfectly and is never crawled, which is assertion 7's
// lesson and has no symptom at all.
const sitemap = existsSync(SITEMAP) ? readFileSync(SITEMAP, 'utf8') : '';
const llms = existsSync(LLMS) ? readFileSync(LLMS, 'utf8') : '';
for (const p of pages) {
	const route = join(ROUTES, `${p.slug}.tsx`);
	if (!existsSync(route)) fail(p.slug, `has no route at routes/symptoms/${p.slug}.tsx`);
	if (!sitemap.includes(`/symptoms/${p.slug}`)) fail(p.slug, 'is missing from sitemap.xml');
	if (!llms.includes(`/symptoms/${p.slug}`)) fail(p.slug, 'is missing from llms.txt');
}
// And the other direction: a route with no page behind it renders nothing.
if (existsSync(ROUTES)) {
	for (const f of readdirSync(ROUTES).filter((x) => x.endsWith('.tsx') && x !== 'index.tsx')) {
		const slug = f.replace(/\.tsx$/, '');
		if (!pages.some((p) => p.slug === slug)) {
			fail(slug, `routes/symptoms/${f} has no markdown behind it`);
		}
	}
}
ok(pages.length * 3, 'pages have a route, a sitemap row and an llms.txt line');

// --------------------------------------------------------------------- 6. house style
//
// No em dashes in shipped copy, which this repo decided once and has re-litigated since. A
// mechanical check is cheaper than noticing.
for (const p of pages) {
	const n = (p.body.match(/—/g) ?? []).length;
	if (n > 0)
		fail(p.slug, `contains ${n} em dash(es). House style, and it is not a suggestion.`);
}
ok(pages.length, 'pages are free of em dashes');

// -------------------------------------------------------------------------- report
const out = failures.length ? process.stderr : process.stdout;
out.write(`\ncontent:lint — ${checked} items across ${pages.length} symptom page(s)\n\n`);
out.write(`${notes.join('\n')}\n`);
if (failures.length > 0) {
	out.write(`\n${failures.length} FAILURE(S):\n${failures.join('\n')}\n\n`);
	process.exit(1);
}
out.write('\nall symptom pages pass\n\n');
