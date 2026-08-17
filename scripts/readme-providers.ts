// Generates the Providers table in README.md from the capability registry.
//
// The README promised this itself and then did not do it: "Once adapters ship, this table is
// generated from the capability registry so it cannot drift from what the router actually
// does. Today it is hand-written and marked accordingly." The adapters shipped, the table
// stayed hand-written, and it drifted exactly as predicted — all four working adapters were
// still marked `planned`, one of them a provider that had been merged, recorded and put into
// the failover chain. A README that under-claims four adapters while its Quickstart advertises
// a hosted endpoint with no DNS record is the opposite of the house rule, in both directions
// at once.
//
// Parsed from the capabilities SOURCE, not imported from the built package. Two reasons, and
// the second is the important one: `repo:check` must run from a clean clone without a build —
// and a table generated from `dist` would go stale the moment someone edited a capability and
// checked the README before rebuilding, which is the failure mode this file exists to end.
//
// Run:  node scripts/readme-providers.ts          # write
//       node scripts/readme-providers.ts --check  # exit 1 on drift

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const SRC = join(ROOT, 'packages/adapters/src');

/** The fence the generated rows live between, so the prose around them stays hand-written. */
export const BEGIN = '<!-- generated:providers -->';
export const END = '<!-- /generated:providers -->';

/**
 * Providers that have no adapter yet.
 *
 * Kept as data here rather than as prose in the README, so the shipped rows and the planned
 * rows cannot disagree about who ships: anything in `REGISTRY` is shipped by definition, and
 * this list is only ever the remainder. A name that gains an adapter must be deleted here, and
 * the assertion below catches it if it is not.
 */
const PLANNED = ['Zyte', 'Oxylabs Web Scraper API', 'ScrapingAnt', 'Firecrawl'] as const;

/** Display names, because `brightdata` is not what Bright Data calls itself. */
const NAMES: Record<string, string> = {
	scraperapi: 'ScraperAPI',
	scrapingbee: 'ScrapingBee',
	scrapfly: 'Scrapfly',
	brightdata: 'Bright Data Web Unlocker',
};

interface Row {
	readonly id: string;
	readonly name: string;
	readonly renderJs: boolean;
	readonly geo: string;
	readonly sessions: boolean;
	readonly post: boolean;
	readonly renderMultiplier: string;
}

/** Ids in `REGISTRY` order, which is also the router's static priority order. */
function registryIds(): string[] {
	const src = readFileSync(join(SRC, 'registry.ts'), 'utf8');
	// Anchored on `= {` at the END of the declaration line. `[^=]*` looked equivalent and was
	// not: the type annotation is `Record<string, () => Promise<Adapter>>`, whose `=>` stops the
	// negated class dead, so it matched nothing and the generator threw.
	const body = /export const REGISTRY[\s\S]*?= \{\n([\s\S]*?)\n\};/.exec(src)?.[1] ?? '';
	return [...body.matchAll(/^\t([a-z][a-z0-9-]*):/gm)].map((m) => m[1] as string);
}

function rowFor(id: string): Row {
	const src = readFileSync(join(SRC, id, 'capabilities.ts'), 'utf8');
	// Anchored to the start of a line with one tab: these fields sit at the top level of the
	// capabilities object, while `renderJs` also appears nested under `multipliers` at two tabs.
	// Matching loosely read the cost multiplier as the capability flag.
	const field = (n: string): string =>
		new RegExp(`^\\t${n}: (.+?),$`, 'm').exec(src)?.[1] ?? '';
	const countries = field('countryCodes');
	return {
		id,
		name: NAMES[id] ?? id,
		renderJs: field('renderJs') === 'true',
		geo:
			countries === "'all'"
				? 'all'
				: `${(countries.match(/'[a-z]{2}'/g) ?? []).length} regions`,
		sessions: field('sessions') === 'true',
		post: field('post') === 'true',
		// From the nested multipliers block, which is the number that actually differs between
		// providers and the one a reader is choosing on.
		renderMultiplier: (/^\t\trenderJs: ([0-9.]+),$/m.exec(src)?.[1] ?? '?') as string,
	};
}

const yn = (b: boolean): string => (b ? 'yes' : '—');

export function render(): string {
	const rows = registryIds().map(rowFor);
	if (rows.length === 0) throw new Error('parsed no providers from registry.ts');
	const lines = [
		'| Provider | Status | JS render | Geo | Sessions | POST | render cost |',
		'|---|---|---|---|---|---|---|',
		...rows.map(
			(r) =>
				`| ${r.name} | **shipped** | ${yn(r.renderJs)} | ${r.geo} | ${yn(r.sessions)} | ` +
				`${yn(r.post)} | ${r.renderMultiplier}× |`,
		),
		...PLANNED.map((name) => `| ${name} | planned | | | | | |`),
	];
	return `${BEGIN}\n${lines.join('\n')}\n${END}`;
}

/** How many providers actually ship, for the counts the README states in prose. */
export function registryProviderCount(): number {
	return registryIds().length;
}

/** Swap the fenced block in the README for a freshly rendered one. */
export function apply(readme: string): string {
	const start = readme.indexOf(BEGIN);
	const end = readme.indexOf(END);
	if (start === -1 || end === -1) {
		throw new Error(`README.md is missing the ${BEGIN} … ${END} fence`);
	}
	return readme.slice(0, start) + render() + readme.slice(end + END.length);
}

/**
 * A planned name that now has an adapter.
 *
 * Without this the provider appears twice — once as shipped, once as planned — which is worse
 * than the drift being fixed, because it looks deliberate.
 */
export function plannedButShipped(): string[] {
	const shipped = new Set(registryIds().map((id) => (NAMES[id] ?? id).toLowerCase()));
	return PLANNED.filter((p) => {
		const first = p.toLowerCase().split(' ')[0] as string;
		return [...shipped].some((s) => s.startsWith(first));
	});
}

if (process.argv[1]?.endsWith('readme-providers.ts')) {
	const current = readFileSync(README, 'utf8');
	const next = apply(current);
	const stale = plannedButShipped();
	if (stale.length > 0) {
		process.stderr.write(`\n  still listed as planned but shipped: ${stale.join(', ')}\n\n`);
		process.exit(1);
	}
	if (process.argv.includes('--check')) {
		if (current !== next) {
			process.stderr.write(
				'\n  README.md providers table is stale — run scripts/readme-providers.ts\n\n',
			);
			process.exit(1);
		}
		process.stdout.write('  README providers table is current\n');
	} else {
		writeFileSync(README, next);
		process.stdout.write('  wrote the providers table into README.md\n');
	}
}
