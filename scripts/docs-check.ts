// docs:check — the docs say what the code does.
//
// Prose is the one part of this repo nothing executes, and documentation rots in a specific,
// predictable way: a parameter is added and never written down, a header is renamed and the
// table still names the old one, a page is added and nothing links to it. Every assertion
// here is one of those, and each one has a failure it would have caught.
//
// It does NOT check that the prose is correct. Nothing can. It checks the things that are
// mechanically checkable, so review can spend its attention on the rest.
//
// Zero dependencies, like every other script here: it must run before anything is built.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifacts } from './docs-artifacts.ts';
// PROSE, not NAMES: prose calls it "Bright Data" where the README table wants the product,
// "Bright Data Web Unlocker". One list either way, so a fifth adapter reaches this check.
import { PROSE } from './readme-providers.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'apps/web/content/docs');
const ROUTES = join(ROOT, 'apps/web/src/routes/docs');
const NAV_FILE = join(ROOT, 'apps/web/src/components/doc-page.tsx');
const LLMS = join(ROOT, 'apps/web/public/llms.txt');
const PUBLIC = join(ROOT, 'apps/web/public');
const SITEMAP = join(ROOT, 'apps/web/public/sitemap.xml');
const APP_CSS = join(ROOT, 'apps/web/src/styles/app.css');
const COPY_TSX = join(ROOT, 'apps/web/src/components/copy-code.tsx');
const DOCS_PLUGIN = join(ROOT, 'apps/web/vite-plugin-docs.ts');
const OPENAPI = join(ROOT, 'apps/web/public/openapi.json');
const GATEWAY_APP = join(ROOT, 'apps/gateway/src/app.ts');
const API_DOC = join(CONTENT, 'api.md');

const failures: string[] = [];
const notes: string[] = [];
let checked = 0;

function fail(id: string, detail: string): void {
	failures.push(`  [${id}] ${detail}`);
}
function ok(id: string, n: number, what: string): void {
	checked += n;
	notes.push(`  ok  ${id.padEnd(3)} ${String(n).padStart(4)} ${what}`);
}
const read = (p: string) => readFileSync(p, 'utf8');

// ------------------------------------------------------------------ 1. pages line up
//
// Three lists must agree: the markdown files, the route files, and the sidebar. Any one of
// them drifting produces a page that exists and cannot be reached, or a link to a 404.
{
	if (!existsSync(CONTENT)) fail('1', `no docs content directory at ${CONTENT}`);
	else {
		const md = readdirSync(CONTENT)
			.filter((f) => f.endsWith('.md'))
			.map((f) => f.replace(/\.md$/, ''));
		const routes = readdirSync(ROUTES)
			.filter((f) => f.endsWith('.tsx') && f !== 'index.tsx')
			.map((f) => f.replace(/\.tsx$/, ''));
		const nav = [...read(NAV_FILE).matchAll(/to: '\/docs\/([a-z-]+)'/g)].map(
			(m) => m[1] as string,
		);

		if (md.length === 0) fail('1', 'no markdown pages found — the scan matched nothing');

		for (const slug of md)
			if (!routes.includes(slug))
				fail('1', `apps/web/content/docs/${slug}.md has no route; add routes/docs/${slug}.tsx`);
		for (const slug of routes)
			if (!nav.includes(slug))
				fail('1', `routes/docs/${slug}.tsx is not in DOC_NAV, so nothing links to it`);
		for (const slug of nav)
			if (!routes.includes(slug))
				fail(
					'1',
					`DOC_NAV links to /docs/${slug}, which has no route file — that link is a 404`,
				);

		ok('1', md.length + routes.length, 'docs pages have a file, a route and a nav entry');
	}
}

// ---------------------------------------------------------- 2. frontmatter is complete
//
// The plugin throws on a missing field at build time, which is correct but late: it fails the
// deploy rather than the pull request. This says which file and which field, in CI.
{
	if (existsSync(CONTENT)) {
		const files = readdirSync(CONTENT).filter((f) => f.endsWith('.md'));
		let n = 0;
		for (const f of files) {
			const src = read(join(CONTENT, f));
			const block = /^---\n([\s\S]*?)\n---/.exec(src);
			if (block === null) {
				fail('2', `${f}: no frontmatter block`);
				continue;
			}
			for (const field of ['title', 'summary']) {
				if (!new RegExp(`^${field}:\\s*\\S`, 'm').test(block[1] ?? ''))
					fail('2', `${f}: frontmatter is missing "${field}"`);
				else n += 1;
			}
		}
		if (files.length === 0) fail('2', 'no markdown pages to check frontmatter on');
		else ok('2', n, 'frontmatter fields present');
	}
}

// ------------------------------------------------- 3. every parameter the gateway reads
//
// THE DRIFT THAT ACTUALLY HAPPENS. A parameter is added to the handler and the table is not
// touched, so the feature ships undocumented and support answers it one thread at a time.
{
	if (!existsSync(GATEWAY_APP)) fail('3', 'apps/gateway/src/app.ts not found');
	else {
		const params = [
			...new Set(
				[...read(GATEWAY_APP).matchAll(/c\.req\.query\('([a-z_]+)'\)/g)].map(
					(m) => m[1] as string,
				),
			),
		];
		const doc = read(API_DOC);
		if (params.length === 0)
			fail('3', 'parsed zero query parameters from the gateway — parser is broken');
		for (const p of params)
			if (!doc.includes(`\`${p}\``))
				fail('3', `the gateway reads \`${p}\` and api.md never mentions it`);
		ok('3', params.length, 'request parameters are documented');
	}
}

// ------------------------------------------------- 4. every header the gateway sets
{
	if (existsSync(GATEWAY_APP)) {
		const src = read(GATEWAY_APP);
		const headers = [
			...new Set(
				[...src.matchAll(/'(X-[A-Za-z-]+|Retry-After|Server-Timing)':/g)].map(
					(m) => m[1] as string,
				),
			),
		];
		const doc = read(API_DOC);
		if (headers.length === 0) fail('4', 'parsed zero response headers from the gateway');
		for (const h of headers)
			if (!doc.includes(`\`${h}\``))
				fail('4', `the gateway sets \`${h}\` and api.md never mentions it`);
		ok('4', headers.length, 'response headers are documented');
	}
}

// ------------------------------------------------------------ 5. internal links resolve
//
// A relative link in markdown is not checked by anything else, and a docs site whose own
// cross-references 404 is worse than one with no cross-references.
{
	if (existsSync(CONTENT)) {
		const routes = new Set([
			'/docs',
			...readdirSync(ROUTES)
				.filter((f) => f.endsWith('.tsx') && f !== 'index.tsx')
				.map((f) => `/docs/${f.replace(/\.tsx$/, '')}`),
		]);
		let n = 0;
		for (const f of readdirSync(CONTENT).filter((x) => x.endsWith('.md'))) {
			for (const m of read(join(CONTENT, f)).matchAll(/\]\((\/[^)#\s]*)/g)) {
				const href = m[1] as string;
				n += 1;
				if (!routes.has(href)) fail('5', `${f} links to ${href}, which is not a route`);
			}
		}
		if (n === 0) fail('5', 'no internal links found — the scan matched nothing');
		else ok('5', n, 'internal doc links resolve');
	}
}

// --------------------------------------------------------------- 6. llms.txt is current
//
// Generated by hand and asserted here rather than emitted by the build: the build would have
// to run to notice, and this is a pull-request-time fact.
{
	if (!existsSync(LLMS)) fail('6', 'apps/web/public/llms.txt is missing');
	else {
		const txt = read(LLMS);
		const listed = [...txt.matchAll(/https:\/\/proxlane\.dev(\/docs\/[a-z-]+)/g)].map(
			(m) => m[1] as string,
		);
		const routes = readdirSync(ROUTES)
			.filter((f) => f.endsWith('.tsx') && f !== 'index.tsx')
			.map((f) => `/docs/${f.replace(/\.tsx$/, '')}`);
		for (const r of routes) if (!listed.includes(r)) fail('6', `llms.txt does not list ${r}`);
		for (const l of listed)
			if (!routes.includes(l)) fail('6', `llms.txt lists ${l}, which is not a route`);
		if (routes.length === 0) fail('6', 'no routes to check llms.txt against');
		else ok('6', routes.length, 'llms.txt lists every docs page');

		// THE SUMMARY BLOCK NAMES EVERY SHIPPED PROVIDER, and it did not.
		//
		// llms.txt opens with a `>` quoted summary — the llms.txt convention's own first
		// paragraph, and the sentence an agent reads before anything else. It named three
		// providers for as long as the fourth had been shipping, while every human-facing
		// surface had already been corrected: the file published specifically for machines
		// carried the stalest claim on the site.
		//
		// Checked against the SUMMARY rather than the whole file. `repo:check` assertion 42
		// asks whether a name appears anywhere in a surface, and llms.txt names all four
		// further down in a link description, so a whole-file check passes on a summary that
		// is wrong. That was verified by mutation before this landed here instead.
		const SHIPPED_PROVIDERS = Object.values(PROSE);
		const summary = txt
			.split('\n')
			.filter((l) => l.startsWith('> '))
			.join(' ');
		if (summary === '') fail('6', 'llms.txt has no `>` summary block to check');
		else {
			const missing = SHIPPED_PROVIDERS.filter((n) => !summary.includes(n));
			if (missing.length > 0)
				fail('6', `llms.txt's summary does not name ${missing.join(', ')}`);
			else ok('6', SHIPPED_PROVIDERS.length, "llms.txt's summary names every shipped provider");
		}
	}
}

// ------------------------------------------------ 6b. every operation types its 200 body
//
// TWO OF THE FIVE DID NOT, and they were the two an operator's tooling polls: /health/providers
// and /health/cooldowns each declared a 200 with a description and no content at all, so a
// generated client got `unknown` back from the only calls it makes repeatedly.
//
// `*/*` counts, and that is not a loophole. GET /v1 returns the TARGET's body — html, json,
// an image, whatever the page was — so `application/json` there would be a lie. What this
// asserts is that a schema exists, not which media type carries it.
{
	const spec = JSON.parse(read(join(ROOT, 'apps/web/public/openapi.json'))) as {
		paths: Record<
			string,
			Record<
				string,
				{
					operationId?: string;
					responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
				}
			>
		>;
	};
	const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
	let typed = 0;
	let total = 0;
	for (const [path, ops] of Object.entries(spec.paths)) {
		for (const [method, op] of Object.entries(ops)) {
			if (!METHODS.includes(method)) continue;
			total += 1;
			const content = op.responses?.['200']?.content ?? {};
			const has = Object.values(content).some((c) => c.schema !== undefined);
			if (has) typed += 1;
			else
				fail(
					'6b',
					`${method.toUpperCase()} ${path} (${op.operationId ?? 'no operationId'}) declares a 200 with no typed body`,
				);
		}
	}
	// Non-zero denominator: a spec that failed to parse into paths would make this vacuous.
	if (total === 0) fail('6b', 'parsed no operations from openapi.json');
	else if (typed === total) ok('6b', total, 'every operation types its 200 body');
}

// ------------------------------------------------------------- 7. the sitemap is complete
//
// THIS ONE HAS ALREADY FAILED IN PRODUCTION. Seven docs pages shipped while sitemap.xml still
// listed exactly one URL, on a project whose entire growth model is search. Adding a page and
// forgetting the sitemap has no symptom: the page works, and simply is never crawled.
{
	if (!existsSync(SITEMAP)) fail('7', 'apps/web/public/sitemap.xml is missing');
	else {
		const locs = [...read(SITEMAP).matchAll(/<loc>https:\/\/proxlane\.dev([^<]*)<\/loc>/g)].map(
			(m) => (m[1] as string).replace(/\/$/, '') || '/',
		);
		const want = [
			'/docs',
			...readdirSync(ROUTES)
				.filter((f) => f.endsWith('.tsx') && f !== 'index.tsx')
				.map((f) => `/docs/${f.replace(/\.tsx$/, '')}`),
		];
		for (const w of want)
			if (!locs.includes(w))
				fail('7', `sitemap.xml does not list ${w}, so it will not be crawled`);
		if (!locs.includes('/')) fail('7', 'sitemap.xml does not list the homepage');
		if (want.length === 0) fail('7', 'no routes to check the sitemap against');
		else ok('7', want.length + 1, 'indexable routes are in the sitemap');
	}
}

// ------------------------------------------------ 8. the agent-facing copies are current
//
// `llms-full.txt` and the raw `.md` pages are generated and committed, so they can go stale
// the moment a page is edited. Byte-identical, the same standard `.github/CODEOWNERS` is held
// to — a "close enough" copy of the docs is a second source of truth.
{
	const want = artifacts();
	let n = 0;
	for (const [rel, content] of want) {
		const path = join(PUBLIC, rel);
		if (!existsSync(path))
			fail(
				'8',
				`apps/web/public/${rel} is missing — run node scripts/docs-artifacts.ts --write`,
			);
		else if (read(path) !== content)
			fail('8', `apps/web/public/${rel} is stale — run node scripts/docs-artifacts.ts --write`);
		else n += 1;
	}
	if (want.size === 0) fail('8', 'no docs artifacts to check');
	else ok('8', n, 'agent-facing docs copies are byte-identical');
}

// ------------------------------------------- 9. classes applied by JS are styled in CSS
//
// THIS SHIPPED BROKEN. `copy-code.tsx` adds `doc-pre` and `doc-copy` to the DOM on mount, and
// an edit to the stylesheet truncated the file and deleted both rules. An unstyled `copy`
// button went to production on every code sample.
//
// Nothing could have caught it: a missing CSS rule is not a build error, the class only
// exists after hydration so the server-rendered HTML is identical either way, and no test
// renders a browser. The one mechanical fact available is that a class name the component
// writes should appear in the stylesheet, so that is what this checks.
{
	if (!existsSync(APP_CSS) || !existsSync(COPY_TSX)) {
		fail('9', 'apps/web/src/styles/app.css or components/copy-code.tsx is missing');
	} else {
		const css = read(APP_CSS);
		// Class names assigned via `className =` or `classList.add(...)` in the component.
		const applied = [
			...new Set([
				...[...read(COPY_TSX).matchAll(/classList\.add\('([a-z-]+)'\)/g)].map(
					(m) => m[1] as string,
				),
				...[...read(COPY_TSX).matchAll(/className = '([a-z-]+)'/g)].map((m) => m[1] as string),
			]),
		];
		if (applied.length === 0)
			fail('9', 'parsed zero class names from copy-code.tsx — the parser stopped matching');
		for (const cls of applied)
			if (!css.includes(`.${cls}`))
				fail('9', `copy-code.tsx applies .${cls} and app.css never styles it`);
		ok('9', applied.length, 'classes applied at runtime are styled');
	}
}

// -------------------------------------------- 10. the CSS can switch every tab the plugin allows
//
// Code tabs are switched with no JavaScript, which means CSS has to pair
// `input[data-i="N"]:checked` with `[data-panel="N"]` for each index by hand — CSS cannot
// count. `MAX_TABS` in the plugin and the number of rule pairs in the stylesheet are two
// numbers that must agree, and nothing else relates them.
//
// Raise MAX_TABS alone and the fifth tab renders a panel that can never be shown: no error,
// no warning, just a tab that does nothing when clicked. Same shape as assertion 9.
{
	if (!existsSync(DOCS_PLUGIN) || !existsSync(APP_CSS)) {
		fail('10', 'apps/web/vite-plugin-docs.ts or src/styles/app.css is missing');
	} else {
		const max = Number(/const MAX_TABS = (\d+)/.exec(read(DOCS_PLUGIN))?.[1] ?? 0);
		const css = read(APP_CSS);
		if (max < 2) fail('10', `could not parse MAX_TABS from the docs plugin (read ${max})`);
		else {
			for (let i = 0; i < max; i++) {
				// Quote-agnostic: the formatter normalises CSS attribute selectors, and an assertion
				// that depends on which quote biome picked is an assertion about the formatter.
				const checked = new RegExp(`\\.doc-tab-input\\[data-i=["']${i}["']\\]:checked`);
				const panel = new RegExp(`\\[data-panel=["']${i}["']\\]`);
				if (!checked.test(css))
					fail('10', `MAX_TABS is ${max} but app.css has no :checked rule for tab ${i}`);
				if (!panel.test(css))
					fail('10', `MAX_TABS is ${max} but app.css never shows panel ${i}`);
			}
			// And no rule beyond the cap, which would be dead CSS implying support that the
			// plugin refuses to emit.
			if (new RegExp(`\\[data-panel=["']${max}["']\\]`).test(css))
				fail(
					'10',
					`app.css styles panel ${max}, past MAX_TABS of ${max} — raise MAX_TABS or drop the rule`,
				);
			ok('10', max, 'code tab indices the CSS can switch');
		}
	}
}

// ------------------------------------------------ 11. search covers every page
//
// The index is built from the markdown, so the two pages that have none — the overview, which
// is a list of links, and the outcome reference, which is generated from the taxonomy — are
// invisible to it unless they are added by hand. `EXTRA_RECORDS` in the plugin does that.
//
// A page missing from search does not look broken. It looks like the docs do not cover the
// thing you searched for, which is worse: the reader stops rather than looking harder.
//
// Parsed as text rather than imported, because this script is zero-dependency by rule and the
// plugin pulls in markdown-it, Shiki and Vite's types.
{
	if (!existsSync(DOCS_PLUGIN)) fail('11', 'apps/web/vite-plugin-docs.ts is missing');
	else {
		const plugin = read(DOCS_PLUGIN);
		const extra = [...plugin.matchAll(/path: '(\/docs[a-z\-/]*)'/g)].map((m) => m[1] as string);
		const md = new Set(
			readdirSync(CONTENT)
				.filter((f) => f.endsWith('.md'))
				.map((f) => `/docs/${f.replace(/\.md$/, '')}`),
		);
		const routes = [
			'/docs',
			...readdirSync(ROUTES)
				.filter((f) => f.endsWith('.tsx') && f !== 'index.tsx')
				.map((f) => `/docs/${f.replace(/\.tsx$/, '')}`),
		];
		let n = 0;
		for (const route of routes) {
			if (md.has(route)) {
				n += 1; // Indexed from its markdown.
			} else if (extra.includes(route)) {
				n += 1; // Indexed by hand, which is the only option for a generated page.
			} else {
				fail(
					'11',
					`${route} has no markdown and no EXTRA_RECORDS entry, so it is invisible to search`,
				);
			}
		}
		for (const e of extra)
			if (!routes.includes(e)) fail('11', `EXTRA_RECORDS indexes ${e}, which is not a route`);
		if (routes.length === 0) fail('11', 'no routes to check the search index against');
		else ok('11', n, 'docs pages reachable by search');
	}
}

// ------------------------------------------------- 12. the OpenAPI spec matches the gateway
//
// The spec is generated from the taxonomy, so its status codes and enums cannot drift. Its
// PARAMETERS list is hand-written, because a generator cannot know what a parameter means —
// and that is the half that goes stale. A parameter added to the handler and not described
// leaves the spec quietly incomplete, and an incomplete spec is worse than none: a client
// generated from it is missing a feature its author has no reason to suspect exists.
//
// Read as JSON rather than imported, keeping this script dependency-free.
{
	if (!existsSync(OPENAPI)) {
		fail('12', 'apps/web/public/openapi.json is missing — run node scripts/openapi.ts --write');
	} else if (!existsSync(GATEWAY_APP)) {
		fail('12', 'apps/gateway/src/app.ts not found');
	} else {
		const spec = JSON.parse(read(OPENAPI)) as {
			paths: Record<string, Record<string, { parameters?: { name: string }[] }>>;
			components: { headers: Record<string, unknown> };
		};
		const src = read(GATEWAY_APP);
		const described = new Set((spec.paths['/v1']?.get?.parameters ?? []).map((p) => p.name));
		const read_ = [
			...new Set([...src.matchAll(/c\.req\.query\('([a-z_]+)'\)/g)].map((m) => m[1] as string)),
		];
		if (read_.length === 0) fail('12', 'parsed zero query parameters from the gateway');
		for (const p of read_)
			if (!described.has(p))
				fail('12', `the gateway reads \`${p}\` and openapi.json does not describe it`);
		for (const p of described)
			if (!read_.includes(p))
				fail('12', `openapi.json describes \`${p}\`, which the gateway never reads`);

		// AND THE LIST THE GATEWAY USES TO REPORT WHAT IT IGNORED, which is the same set a third
		// time. `KNOWN_PARAMS` drives `X-Ignored-Params`, so a parameter added to the handler and
		// left out of it would be reported as ignored on every request that sends it — the header
		// would name a parameter the gateway had just honoured, which is worse than no header.
		const knownBlock = /const KNOWN_PARAMS: readonly string\[\] = \[([^\]]*)\]/.exec(src);
		if (knownBlock === null) {
			fail('12', 'apps/gateway/src/app.ts no longer declares KNOWN_PARAMS');
		} else {
			const known = [...(knownBlock[1] as string).matchAll(/'([a-z_]+)'/g)].map(
				(m) => m[1] as string,
			);
			if (known.length === 0) fail('12', 'parsed zero names from KNOWN_PARAMS');
			for (const p of read_)
				if (!known.includes(p))
					fail(
						'12',
						`the gateway reads \`${p}\` and KNOWN_PARAMS omits it, so it would be reported as ignored`,
					);
			for (const p of known)
				if (!read_.includes(p))
					fail('12', `KNOWN_PARAMS lists \`${p}\`, which the gateway never reads`);
		}

		// Response headers, same argument.
		const setHeaders = [
			...new Set(
				[...src.matchAll(/'(X-[A-Za-z-]+|Retry-After|Server-Timing)':/g)].map(
					(m) => m[1] as string,
				),
			),
		];
		for (const h of setHeaders)
			if (!(h in spec.components.headers))
				fail('12', `the gateway sets \`${h}\` and openapi.json does not document it`);

		// And the routes it serves.
		const routes = [
			...new Set([...src.matchAll(/app\.(?:get|post)\('([^']+)'/g)].map((m) => m[1] as string)),
		];
		for (const r of routes)
			if (!(r in spec.paths))
				fail('12', `the gateway serves \`${r}\` and openapi.json omits it`);

		ok('12', read_.length + setHeaders.length + routes.length, 'OpenAPI matches the gateway');
	}
}

// ---------------- 13: every docs URL the code emits points at a page that exists
//
// THE GATEWAY PUTS A LINK ON EVERY ERROR RESPONSE. A dead one is a broken promise at request
// rate, which is why `error.docs` used to point at GitHub — `docs.proxlane.dev` has no DNS
// record and the comment said so. The docs site turned out to be live at the apex all along,
// so the link now goes to `/docs/outcomes`, and this is what keeps that honest.
//
// Checked STATICALLY, against the route files and the rendered anchors. A test that resolved
// the URL over the network would fail from a clean clone offline, and CI would then be
// asserting that GitHub's DNS works.
{
	const SHARED = join(ROOT, 'packages/shared/src');
	const outcomeSrc = join(SHARED, 'outcome.ts');
	const errorSrc = join(SHARED, 'error-body.ts');
	if (!existsSync(outcomeSrc) || !existsSync(errorSrc)) {
		fail('13', 'packages/shared/src/{outcome,error-body}.ts not found');
	} else {
		const src = read(outcomeSrc) + read(errorSrc);
		// Every `https://proxlane.dev/...` the package can produce, plus the DOCS_BASE template
		// forms. Literal paths only — an interpolated class is checked as an anchor below.
		const paths = [
			...new Set(
				[...src.matchAll(/\$\{DOCS_BASE\}(\/[a-z0-9/-]*)/g)].map((m) => m[1] as string),
			),
		];
		if (paths.length === 0) {
			fail('13', 'parsed no DOCS_BASE paths from shared — the URL shape changed');
		}
		let verified = 0;
		for (const path of paths) {
			// `/docs/outcomes` -> `routes/docs/outcomes.tsx`; `/docs` -> `routes/docs/index.tsx`.
			const slug = path.replace(/^\/docs\/?/, '');
			const file = slug === '' ? join(ROUTES, 'index.tsx') : join(ROUTES, `${slug}.tsx`);
			if (!existsSync(file)) {
				fail('13', `shared emits ${path}, and ${relative(ROOT, file)} does not exist`);
			} else verified += 1;
		}
		// `docsUrlFor` deep-links to `#<class>`, so every class must render an anchor. The
		// outcomes route renders `<h3 id={cls}>` over OUTCOME_CLASSES, which is what makes that
		// total — assert the mechanism rather than six literals, or adding a class breaks the
		// links silently.
		if (/docsUrlFor/.test(src)) {
			const outcomesRoute = join(ROUTES, 'outcomes.tsx');
			if (!existsSync(outcomesRoute)) {
				fail('13', 'docsUrlFor targets /docs/outcomes, whose route file is missing');
			} else if (!/id=\{cls\}/.test(read(outcomesRoute))) {
				fail(
					'13',
					'docsUrlFor deep-links to #<class>, and routes/docs/outcomes.tsx no longer ' +
						'renders `id={cls}` — every one of those links is now dead',
				);
			} else verified += 1;
		}
		if (verified > 0) ok('13', verified, 'docs URLs emitted by the code resolve to real pages');
	}
}

// -------------------------------------------------------------------------- report

const out = failures.length ? process.stderr : process.stdout;
out.write(`\ndocs:check — ${checked} items across ${notes.length} assertions\n\n`);
out.write(`${notes.join('\n')}\n`);
if (failures.length) {
	out.write(`\n${failures.length} FAILURE(S):\n${failures.join('\n')}\n\n`);
	out.write(
		'  Owner: docs-writer — apps/web/content/docs/** and apps/web/src/routes/docs/**\n\n',
	);
	process.exit(1);
}
out.write('\nall assertions pass\n\n');
