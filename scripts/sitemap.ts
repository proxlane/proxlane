// The sitemap's generated half, written from `enumerateSite()`.
//
// The hand-written half stays hand-written: the landing page, the docs and the symptom pages
// are decided by people. Everything derived from the taxonomy is written here, between fences,
// so the two cannot be confused and `pages:check` has something exact to compare against.
//
// The fence is the same device `scripts/readme-providers.ts` uses on the README, and for the
// same reason: prose around a generated block stays editable, and the block cannot drift.
//
// Run:  node scripts/sitemap.ts          # write
//       node scripts/sitemap.ts --check  # exit 1 on drift

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateSite } from '../apps/web/src/generators/site.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP = join(ROOT, 'apps/web/public/sitemap.xml');
const BEGIN = '  <!-- generated:pages -->';
const END = '  <!-- /generated:pages -->';

function render(): string {
	const rows = enumerateSite()
		.map(
			(p) =>
				`  <url>\n    <loc>https://proxlane.dev${p.path}</loc>\n` +
				`    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
		)
		.join('\n');
	return `${BEGIN}\n${rows}\n${END}`;
}

const current = readFileSync(SITEMAP, 'utf8');
const start = current.indexOf(BEGIN);
const end = current.indexOf(END);
if (start === -1 || end === -1) {
	process.stderr.write(`\n  ${SITEMAP} is missing the ${BEGIN} … ${END} fence\n\n`);
	process.exit(1);
}
const next = current.slice(0, start) + render() + current.slice(end + END.length);

if (process.argv.includes('--check')) {
	if (current !== next) {
		process.stderr.write(
			'\n  sitemap.xml generated block is stale — run node scripts/sitemap.ts\n\n',
		);
		process.exit(1);
	}
	process.stdout.write('  sitemap generated block is current\n');
} else {
	writeFileSync(SITEMAP, next);
	process.stdout.write(`  wrote ${enumerateSite().length} generated rows into sitemap.xml\n`);
}
