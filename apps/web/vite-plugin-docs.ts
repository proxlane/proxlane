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

import { readFileSync } from 'node:fs';
import MarkdownIt from 'markdown-it';
import { createHighlighter } from 'shiki';
import type { Plugin } from 'vite';

/** Only what the docs actually use. Every grammar loaded is bundle weight and startup cost. */
const LANGS = ['bash', 'json', 'http', 'typescript'] as const;
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

/**
 * `import doc from './x.md?docs'` gives a `RenderedDoc`.
 *
 * Also registers the file as a watch dependency, so editing markdown hot-reloads the page
 * rather than requiring a dev-server restart — the thing that decides whether anyone actually
 * writes documentation.
 */
export function docsPlugin(): Plugin {
	return {
		name: 'proxlane-docs',
		enforce: 'pre',
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
