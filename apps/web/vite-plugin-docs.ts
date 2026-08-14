// Markdown to HTML, at BUILD TIME.
//
// The docs are markdown files in the repo — versioned, diffable, reviewable in a PR, and
// editable by anyone who can write markdown rather than only by someone who can write TSX.
// That is the whole point: documentation that lives next to the code it documents and moves
// through the same review as the code it documents.
//
// WHY A VITE PLUGIN AND NOT A RUNTIME PARSE. `apps/web` runs on Cloudflare Workers. Parsing
// and highlighting at request time would ship `markdown-it`, Shiki's TextMate grammars and a
// regex engine to the edge, then re-render byte-identical output on every cold isolate,
// forever, for a file that cannot change between deploys. Doing it here means the Worker
// receives finished HTML strings and neither library is in its bundle — which is also why
// both are devDependencies rather than dependencies.
//
// The transform is keyed on the `?docs` suffix so it cannot collide with anything else Vite
// does with markdown, and so an accidental plain `import './x.md'` fails loudly.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import MarkdownIt from 'markdown-it';
import { createHighlighter } from 'shiki';
import type { Plugin } from 'vite';

/** Only what the docs actually use. Every grammar loaded is bundle weight and startup cost. */
const LANGS = ['bash', 'json', 'http', 'typescript', 'javascript', 'python'] as const;

/**
 * The most tabs one group may carry.
 *
 * Switching is CSS-only, and CSS cannot count: each index needs its own static rule pairing
 * `input[data-i="N"]:checked` with `[data-panel="N"]`. Four rules are written by hand in
 * `app.css`, so a fifth tab would silently render a panel that can never be shown. Throwing
 * here makes that a build failure with a file name instead.
 */
const MAX_TABS = 4;
/** One theme per colour scheme; the CSS variables theme would need runtime tokens. */
const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

export interface DocHeading {
	readonly depth: 2 | 3;
	readonly id: string;
	readonly text: string;
}

export interface RenderedDoc {
	readonly slug: string;
	readonly title: string;
	readonly summary: string;
	readonly html: string;
	/** Every h2 and h3, in document order, for the on-page contents. */
	readonly headings: readonly DocHeading[];
}

/**
 * Turn a heading into a URL fragment.
 *
 * Hand-rolled rather than `github-slugger`, because the rule that matters is only that it is
 * stable and collision-free within one page — and a dependency whose entire job is one
 * regular expression is a dependency to maintain, review and update forever.
 */
function slug(text: string, seen: Map<string, number>): string {
	const base =
		text
			.toLowerCase()
			.replace(/[^\w\s-]/g, '')
			.trim()
			.replace(/\s+/g, '-') || 'section';
	const n = seen.get(base) ?? 0;
	seen.set(base, n + 1);
	return n === 0 ? base : `${base}-${n}`;
}

/**
 * Frontmatter, deliberately minimal: `title` and `summary`, both required.
 *
 * Not YAML, and not a YAML parser. Two flat string fields is the entire contract, and a
 * parser for arbitrary YAML would invite the frontmatter to grow into configuration that
 * belongs in code. A missing field throws at build time rather than rendering a page with no
 * title, which is the failure that reaches production silently.
 */
function frontmatter(
	src: string,
	file: string,
): { meta: Record<string, string>; body: string } {
	const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
	if (m === null) throw new Error(`${file}: missing frontmatter block`);
	const meta: Record<string, string> = {};
	for (const line of (m[1] ?? '').split('\n')) {
		const kv = /^([a-z]+):\s*(.+)$/.exec(line.trim());
		if (kv?.[1] !== undefined && kv[2] !== undefined)
			meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
	}
	for (const required of ['title', 'summary']) {
		if (meta[required] === undefined)
			throw new Error(`${file}: frontmatter is missing "${required}"`);
	}
	return { meta, body: src.slice(m[0].length) };
}

/**
 * One highlighter for the whole build.
 *
 * Shiki says it outright: it is meant to be a singleton. Creating one per file spun up ten
 * instances across the client and server passes, each loading the same four grammars and two
 * themes, and Shiki warned about it on every build.
 */
let highlighterOnce: ReturnType<typeof createHighlighter> | undefined;
function highlighterFor() {
	highlighterOnce ??= createHighlighter({ themes: Object.values(THEMES), langs: [...LANGS] });
	return highlighterOnce;
}

/**
 * `bash tab=cURL` -> `cURL`. Anything without `tab=` is an ordinary code block.
 *
 * The label is free text after the marker so it reads as a language name rather than an id:
 * `Node`, not `javascript`. A run of consecutive fences that all carry one becomes a tab set.
 */
function tabLabel(info: string): string | undefined {
	const m = /\btab=(.+)$/.exec(info.trim());
	return m?.[1]?.trim();
}

/**
 * Tabbed code samples, switched with NO JAVASCRIPT.
 *
 * Every reference site worth copying offers the same request in several languages, and the
 * usual implementation is a React island per group. This is a hidden radio group and four
 * static CSS rules instead, which matters for two reasons: the markdown becomes finished HTML
 * at build time and has no React in it, and a code sample that needs JavaScript to be visible
 * is a code sample that is invisible when the bundle fails.
 *
 * Radios rather than buttons because the semantics are already right: one of a set, arrow-key
 * navigable, labelled, and restorable by the browser. A `role="tablist"` of buttons would
 * need script to do any of that.
 */
function renderTabs(
	blocks: readonly { readonly label: string; readonly html: string }[],
	group: number,
	file: string,
): string {
	if (blocks.length > MAX_TABS) {
		throw new Error(
			`${file}: a code tab group has ${blocks.length} tabs; the CSS supports ${MAX_TABS}. ` +
				'Add a rule pair in app.css and raise MAX_TABS, or use fewer languages.',
		);
	}
	const name = `doc-tabs-${group}`;
	const parts: string[] = [
		`<div class="doc-tabs" role="group" aria-label="The same request in ${blocks.length} languages">`,
	];
	blocks.forEach((b, i) => {
		const id = `${name}-${i}`;
		parts.push(
			`<input class="doc-tab-input" type="radio" name="${name}" id="${id}" data-i="${i}"${i === 0 ? ' checked' : ''}>`,
			`<label class="doc-tab" for="${id}" data-i="${i}" data-lang="${escapeAttr(b.label)}">${escapeHtml(b.label)}</label>`,
		);
	});
	blocks.forEach((b, i) => {
		parts.push(`<div class="doc-tab-panel" data-panel="${i}">${b.html}</div>`);
	});
	parts.push('</div>');
	return parts.join('');
}

const escapeHtml = (s: string): string =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => escapeHtml(s).replace(/"/g, '&quot;');

export async function renderDoc(file: string, slugName: string): Promise<RenderedDoc> {
	const { meta, body } = frontmatter(readFileSync(file, 'utf8'), file);
	const highlighter = await highlighterFor();

	const md = new MarkdownIt({
		html: false, // The source is ours, but disallowing raw HTML keeps the output auditable.
		linkify: true,
		typographer: false, // Never smart-quote a code sample or a header name.
		highlight: (code, lang) => {
			const language = (LANGS as readonly string[]).includes(lang) ? lang : 'text';
			// Dual-theme output: Shiki emits both palettes as CSS variables on one tree, so the
			// theme toggle switches highlighting with everything else and no JavaScript reruns.
			return highlighter.codeToHtml(code, {
				lang: language === 'text' ? 'bash' : language,
				themes: THEMES,
				defaultColor: false,
			});
		},
	});

	// TAB GROUPS, as a core rule rather than a fence renderer.
	//
	// The grouping question is "are these fences adjacent", which a per-fence renderer cannot
	// answer: it sees one token and has no idea what follows. A core rule runs over the whole
	// token stream after parsing, so it can find a run and replace it with one html_block.
	let group = 0;
	md.core.ruler.push('proxlane-tab-groups', (state) => {
		const tokens = state.tokens;
		for (let i = 0; i < tokens.length; i++) {
			if (tokens[i]?.type !== 'fence') continue;
			if (tabLabel(tokens[i]?.info ?? '') === undefined) continue;

			let j = i;
			while (
				j < tokens.length &&
				tokens[j]?.type === 'fence' &&
				tabLabel(tokens[j]?.info ?? '') !== undefined
			) {
				j += 1;
			}
			// A lone tabbed fence is just a code block that happens to be labelled. Wrapping one
			// panel in a tab strip is a control with nothing to switch to.
			if (j - i < 2) continue;

			const blocks = tokens.slice(i, j).map((t) => ({
				label: tabLabel(t.info) as string,
				// `renderToken` is not enough: the fence rule is what applies Shiki. Rendering the
				// single token through the renderer gives the highlighted `<pre>` verbatim.
				html: md.renderer.render([t], md.options, {}),
			}));

			const token = new state.Token('html_block', '', 0);
			token.content = renderTabs(blocks, group, file);
			group += 1;
			tokens.splice(i, j - i, token);
		}
		return true;
	});

	const headings: DocHeading[] = [];
	const seen = new Map<string, number>();

	// ANCHORS ON EVERY HEADING, which is the single convention that makes documentation
	// linkable in an issue thread — the form support actually takes. Done as a renderer rule
	// rather than a plugin dependency: it is fifteen lines and one less package to trust.
	const defaultHeading =
		md.renderer.rules.heading_open ??
		((tokens, i, options, _env, self) => self.renderToken(tokens, i, options));
	md.renderer.rules.heading_open = (tokens, i, options, env, self) => {
		const token = tokens[i];
		const inline = tokens[i + 1];
		if (token === undefined || inline === undefined)
			return defaultHeading(tokens, i, options, env, self);
		const depth = Number(token.tag.slice(1));
		const text = inline.content;
		const id = slug(text, seen);
		token.attrSet('id', id);
		if (depth === 2 || depth === 3) headings.push({ depth, id, text });
		return defaultHeading(tokens, i, options, env, self);
	};

	// External links leave in a new tab and carry rel; internal ones must not, or every
	// in-page reference spawns a window.
	const defaultLink =
		md.renderer.rules.link_open ??
		((tokens, i, options, _env, self) => self.renderToken(tokens, i, options));
	md.renderer.rules.link_open = (tokens, i, options, env, self) => {
		const href = String(tokens[i]?.attrGet('href') ?? '');
		if (/^https?:\/\//.test(href)) {
			tokens[i]?.attrSet('target', '_blank');
			tokens[i]?.attrSet('rel', 'noreferrer');
		}
		return defaultLink(tokens, i, options, env, self);
	};

	return {
		slug: slugName,
		title: meta.title as string,
		summary: meta.summary as string,
		html: md.render(body),
		headings,
	};
}

export interface SearchRecord {
	/** Where to send the reader. Includes the fragment when the hit is inside a section. */
	readonly path: string;
	readonly page: string;
	/** The section heading, or the page summary for the lead section. */
	readonly heading: string;
	/** Plain prose, lowercased at query time rather than here so excerpts keep their case. */
	readonly text: string;
}

/**
 * Pages the index cannot read from markdown, because they have none.
 *
 * The overview is a list of links and the outcome reference is generated from the taxonomy.
 * Leaving them out would make search quietly incomplete, which is worse than not having it:
 * a reader who searches "429" and gets nothing concludes the docs do not cover it.
 * `docs:check` asserts every route appears in the index.
 */
const EXTRA_RECORDS: readonly SearchRecord[] = [
	{
		path: '/docs',
		page: 'Overview',
		heading: 'Documentation',
		text: 'One endpoint in front of every scraping API. Start here. Quickstart hosting API reference outcomes failover agents use cases.',
	},
	{
		path: '/docs/changelog',
		page: 'Changelog',
		heading: 'Changelog',
		text: 'What changed, per package, newest first. Release notes for the gateway, CLI, adapters, detection and shared packages, generated from changesets.',
	},
	{
		path: '/docs/outcomes',
		page: 'Outcomes',
		heading: 'Outcomes',
		text: 'What every result means, what it returns, and whether to retry. Every outcome, its HTTP status code, whether it fails over and whether it is billed. Branch on the class, which never grows. Status codes 200 400 403 413 429 502 503 504.',
	},
];

/** Strip markdown to prose: no fences, no inline code ticks, no link syntax, no tables. */
function toPlainText(md: string): string {
	return md
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/^\|.*$/gm, ' ')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/[`*_>#]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * The search index, built from the same markdown the pages are.
 *
 * ONE RECORD PER SECTION, not per page. A page-level hit can only say "the answer is
 * somewhere on the API reference", which for a long reference page is barely an answer; a
 * section-level hit lands on the heading that contains it.
 */
export function buildSearchIndex(contentDir: string): SearchRecord[] {
	const out: SearchRecord[] = [];
	for (const file of readdirSync(contentDir)
		.filter((f) => f.endsWith('.md'))
		.sort()) {
		const slug = file.replace(/\.md$/, '');
		const src = readFileSync(join(contentDir, file), 'utf8');
		const fm = /^---\n([\s\S]*?)\n---\n?/.exec(src);
		const page = /^title:\s*(.+)$/m.exec(fm?.[1] ?? '')?.[1]?.trim() ?? slug;
		const summary = /^summary:\s*(.+)$/m.exec(fm?.[1] ?? '')?.[1]?.trim() ?? '';
		const body = fm === null ? src : src.slice(fm[0].length);

		// Split on headings, keeping the heading with the prose beneath it.
		const seen = new Map<string, number>();
		const sections = body.split(/^(#{2,3})\s+(.+)$/m);
		const lead = toPlainText(sections[0] ?? '');
		out.push({
			path: `/docs/${slug}`,
			page,
			heading: page,
			text: `${summary} ${lead}`.trim(),
		});
		for (let i = 1; i < sections.length; i += 3) {
			const heading = (sections[i + 1] ?? '').trim();
			const text = toPlainText(sections[i + 2] ?? '');
			if (heading === '') continue;
			out.push({
				path: `/docs/${slug}#${slug1(heading, seen)}`,
				page,
				heading,
				text,
			});
		}
	}
	return [...out, ...EXTRA_RECORDS];
}

/** The same slug rule the renderer uses, so a search hit's fragment resolves to a real anchor. */
function slug1(text: string, seen: Map<string, number>): string {
	return slug(text, seen);
}

/**
 * `import doc from './x.md?docs'` gives a `RenderedDoc`.
 *
 * Also registers the file as a watch dependency, so editing markdown hot-reloads the page
 * rather than requiring a dev-server restart — the thing that decides whether anyone actually
 * writes documentation.
 */
// ------------------------------------------------------------------------- changelog

/**
 * The packages a reader of these docs actually consumes.
 *
 * Not every workspace package. `ui`, `route-viz`, `db` and the web app are internal, and a
 * changelog that reports a token rename next to a routing change teaches people to stop
 * reading it. Ordered by how likely someone is to care.
 */
const CHANGELOG_PACKAGES: readonly {
	readonly dir: string;
	readonly label: string;
	readonly note: string;
}[] = [
	{ dir: 'apps/gateway', label: 'Gateway', note: 'The proxy itself. This is what you run.' },
	{ dir: 'packages/cli', label: 'CLI', note: 'The `proxlane` command.' },
	{
		dir: 'packages/adapters',
		label: 'Adapters',
		note: 'Provider adapters and the capability registry.',
	},
	{ dir: 'packages/detect', label: 'Detection', note: 'Block-page heuristics.' },
	{ dir: 'packages/shared', label: 'Shared', note: 'The outcome taxonomy and request types.' },
];

export interface ChangelogEntry {
	readonly version: string;
	readonly kind: 'Major' | 'Minor' | 'Patch';
	readonly notes: readonly string[];
	/** True when the release carried nothing but dependency bumps. */
	readonly dependenciesOnly: boolean;
}

export interface ChangelogPackage {
	readonly label: string;
	readonly note: string;
	readonly current: string;
	readonly releases: readonly ChangelogEntry[];
}

/**
 * Parse a changesets-generated CHANGELOG.md.
 *
 * DEPENDENCY BUMPS ARE FILTERED. Changesets writes "Updated dependencies [sha]" followed by
 * the packages, which is accurate and useless to a reader: it says a number moved, not what
 * changed. Roughly half the lines in these files are that. A release left with nothing is
 * still listed, marked as dependencies only, because silently dropping a version makes the
 * list look like it has gaps.
 */
export function parseChangelog(md: string): ChangelogEntry[] {
	const out: ChangelogEntry[] = [];
	// `## 1.2.3` starts a release; `### Minor Changes` sets the kind for what follows.
	const sections = md.split(/^## (?=\d)/m).slice(1);
	for (const section of sections) {
		const version = /^([\d.]+)/.exec(section)?.[1];
		if (version === undefined) continue;
		let kind: ChangelogEntry['kind'] = 'Patch';
		const notes: string[] = [];
		let sawDependency = false;
		let inDependencyBlock = false;

		for (const raw of section.split('\n').slice(1)) {
			const line = raw.trimEnd();
			const heading = /^### (Major|Minor|Patch) Changes/.exec(line);
			if (heading !== null) {
				// The largest bump wins the label: a release with both minor and patch notes is a
				// minor release.
				const found = heading[1] as ChangelogEntry['kind'];
				if (kind === 'Patch' || found === 'Major') kind = found;
				continue;
			}
			if (/^- Updated dependencies/.test(line)) {
				sawDependency = true;
				inDependencyBlock = true;
				continue;
			}
			// The indented package list that follows an "Updated dependencies" bullet.
			if (inDependencyBlock && /^\s+- /.test(line)) continue;
			const bullet = /^- (?:[0-9a-f]{7,}: )?(.*)$/.exec(line);
			if (bullet !== null) {
				inDependencyBlock = false;
				const text = (bullet[1] ?? '').trim();
				if (text !== '') notes.push(text);
				continue;
			}
			// A wrapped continuation of the previous bullet.
			if (!inDependencyBlock && /^\s{2,}\S/.test(line) && notes.length > 0) {
				notes[notes.length - 1] = `${notes[notes.length - 1]} ${line.trim()}`;
			}
		}
		out.push({
			version,
			kind,
			notes,
			dependenciesOnly: notes.length === 0 && sawDependency,
		});
	}
	return out;
}

export function buildChangelog(root: string): ChangelogPackage[] {
	const out: ChangelogPackage[] = [];
	for (const pkg of CHANGELOG_PACKAGES) {
		const file = join(root, pkg.dir, 'CHANGELOG.md');
		const manifest = join(root, pkg.dir, 'package.json');
		let md: string;
		let current: string;
		try {
			md = readFileSync(file, 'utf8');
			current = JSON.parse(readFileSync(manifest, 'utf8')).version ?? '0.0.0';
		} catch {
			// A package with no releases yet is not an error; it simply has nothing to show.
			continue;
		}
		// Notes carry inline markdown — `code`, **bold**, links — so they are rendered here
		// rather than shipped raw and shown with the backticks still in them. Inline only: a
		// release note is a sentence, and `render` would wrap each in its own paragraph.
		const inline = new MarkdownIt({ html: false, linkify: false, typographer: false });
		const releases = parseChangelog(md).map((r) => ({
			...r,
			notes: r.notes.map((n) => inline.renderInline(n)),
		}));
		if (releases.length === 0) continue;
		out.push({ label: pkg.label, note: pkg.note, current, releases });
	}
	return out;
}

const CHANGELOG_ID = 'virtual:docs-changelog';
const RESOLVED_CHANGELOG_ID = `\0${CHANGELOG_ID}`;

const SEARCH_ID = 'virtual:docs-search';
const RESOLVED_SEARCH_ID = `\0${SEARCH_ID}`;

export function docsPlugin(options?: { readonly contentDir?: string }): Plugin {
	// Relative to the Vite root, which is `apps/web`. Passed in only by tests.
	const contentDir = options?.contentDir ?? 'content/docs';
	return {
		name: 'proxlane-docs',
		enforce: 'pre',
		// `import index from 'virtual:docs-search'` gives the whole index, built here so no
		// markdown parser reaches the browser. The leading NUL is Vite's convention for a
		// resolved virtual id: it stops other plugins and the filesystem from claiming it.
		resolveId(id) {
			if (id === SEARCH_ID) return RESOLVED_SEARCH_ID;
			if (id === CHANGELOG_ID) return RESOLVED_CHANGELOG_ID;
			return null;
		},
		load(id) {
			if (id === RESOLVED_SEARCH_ID)
				return `export default ${JSON.stringify(buildSearchIndex(contentDir))}`;
			// `../..` from `apps/web` is the repo root, where the package CHANGELOGs live.
			if (id === RESOLVED_CHANGELOG_ID)
				return `export default ${JSON.stringify(buildChangelog('../..'))}`;
			return null;
		},
		// Editing a page rebuilds the index rather than serving a stale one in dev.
		configureServer(server) {
			server.watcher.add(contentDir);
			server.watcher.on('change', (file) => {
				if (!file.endsWith('.md')) return;
				const mod = server.moduleGraph.getModuleById(RESOLVED_SEARCH_ID);
				if (mod !== undefined) server.moduleGraph.invalidateModule(mod);
			});
		},
		async transform(_code, id) {
			if (!id.endsWith('.md?docs')) return null;
			const file = id.slice(0, -'?docs'.length);
			const name = file.split('/').pop()?.replace(/\.md$/, '') ?? 'index';
			const doc = await renderDoc(file, name);
			this.addWatchFile(file);
			return { code: `export default ${JSON.stringify(doc)}`, map: null };
		},
	};
}
