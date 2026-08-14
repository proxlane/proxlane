// The agent-facing copies of the docs: `llms-full.txt` and markdown-at-`.md`.
//
// `CLAUDE.md`'s ownership table has named both as docs-writer's since the scaffold. Neither
// existed. They are the two conventions that make documentation readable by something that
// is not a browser:
//
//   llms-full.txt      every page in one file, for a model that would rather read one
//                      document than crawl seven
//   /docs/api.md       the raw markdown behind a page, so an agent can fetch the source
//                      rather than parse rendered HTML back into prose
//
// GENERATED AND COMMITTED, then asserted byte-identical by `docs:check` — the same pattern as
// `.github/CODEOWNERS`. The alternative, emitting them during the web build, means nothing
// notices they are stale until a deploy runs, and this is a pull-request-time fact.
//
// Run with `--write` to regenerate. Without it, it prints what would change and exits 1.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'apps/web/content/docs');
const PUBLIC = join(ROOT, 'apps/web/public');
const SITE = 'https://proxlane.dev';

/** Reading order. Mirrors `DOC_NAV`; `docs:check` assertion 1 keeps the two in step. */
const ORDER = ['quickstart', 'hosting', 'api', 'failover', 'agents', 'use-cases'] as const;

function stripFrontmatter(src: string): { title: string; body: string } {
	const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
	const title = /^title:\s*(.+)$/m.exec(m?.[1] ?? '')?.[1]?.trim() ?? 'Untitled';
	return { title, body: m === null ? src : src.slice(m[0].length) };
}

export function buildLlmsFull(): string {
	const parts = [
		'# Proxlane, full documentation',
		'',
		'> One endpoint in front of every scraping API. Automatic failover across ScraperAPI,',
		'> ScrapingBee and Scrapfly, with honest block detection. AGPL and self-hostable.',
		'',
		'Every documentation page concatenated, for a reader that would rather take one document',
		`than crawl seven. The rendered pages are at ${SITE}/docs, and each page's raw markdown is`,
		'served at its own URL with a `.md` suffix.',
		'',
		'The outcome reference is generated from the taxonomy rather than written, so it is not',
		`included here. Read it at ${SITE}/docs/outcomes or run \`npx proxlane outcomes --json\`.`,
	];
	for (const slug of ORDER) {
		const { title, body } = stripFrontmatter(readFileSync(join(CONTENT, `${slug}.md`), 'utf8'));
		parts.push(
			'',
			'',
			'---',
			'',
			`# ${title}`,
			'',
			`Source: ${SITE}/docs/${slug}`,
			'',
			body.trim(),
		);
	}
	return `${parts.join('\n')}\n`;
}

/** The raw page, with a line saying where it came from. Frontmatter stays: it carries the title. */
export function buildRawPage(slug: string): string {
	const src = readFileSync(join(CONTENT, `${slug}.md`), 'utf8');
	return `<!-- Source: ${SITE}/docs/${slug} — edit apps/web/content/docs/${slug}.md -->\n${src}`;
}

export function artifacts(): Map<string, string> {
	const out = new Map<string, string>();
	out.set('llms-full.txt', buildLlmsFull());
	for (const f of readdirSync(CONTENT).filter((x) => x.endsWith('.md'))) {
		const slug = f.replace(/\.md$/, '');
		out.set(join('docs', `${slug}.md`), buildRawPage(slug));
	}
	return out;
}

// Only act when run directly; `docs:check` imports the builders above.
if (process.argv[1]?.endsWith('docs-artifacts.ts') === true) {
	const write = process.argv.includes('--write');
	const stale: string[] = [];
	for (const [rel, content] of artifacts()) {
		const path = join(PUBLIC, rel);
		const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
		if (current === content) continue;
		stale.push(rel);
		if (write) {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, content);
		}
	}
	if (write) {
		process.stdout.write(
			stale.length === 0
				? '  docs artifacts already current\n'
				: `  wrote ${stale.length}: ${stale.join(', ')}\n`,
		);
	} else if (stale.length > 0) {
		process.stderr.write(
			`\n  ${stale.length} docs artifact(s) are stale:\n` +
				stale.map((s) => `    apps/web/public/${s}`).join('\n') +
				'\n\n  Regenerate:  node scripts/docs-artifacts.ts --write\n\n',
		);
		process.exit(1);
	} else {
		process.stdout.write('  docs artifacts current\n');
	}
}
