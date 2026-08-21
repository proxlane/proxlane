// pnpm new-adapter <id> — scaffolds one provider adapter.
//
// Per integrations.md section 8 it produces: a capabilities file, translate/parse stubs, a
// Zod response schema, a fixture directory and conformance registration. What it
// deliberately does NOT produce is a working adapter — every stub throws, so an unfinished
// adapter fails loudly rather than silently returning something plausible.
//
// Zero dependencies, like the rest of scripts/: this runs before anything is built.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Overridable so the generator can be tested into a temp directory rather than by
// scaffolding a real adapter into the repo and deleting it afterwards.
const ADAPTERS = process.env.PROXLANE_ADAPTERS_DIR ?? join(ROOT, 'packages/adapters/src');

const id = process.argv[2];

if (!id) {
	process.stderr.write(
		'usage: pnpm new-adapter <id>        e.g. pnpm new-adapter scraperapi\n',
	);
	process.exit(2);
}
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
	process.stderr.write(
		`invalid id "${id}": lowercase letters, digits and hyphens, starting with a letter.\n` +
			'The id is a directory name, a ProviderId and a URL path segment on the docs site.\n',
	);
	process.exit(2);
}

const dir = join(ADAPTERS, id);
if (existsSync(dir)) {
	process.stderr.write(`packages/adapters/src/${id} already exists. Refusing to overwrite.\n`);
	process.exit(2);
}

const pascal = id
	.split('-')
	.map((p) => (p[0] ?? '').toUpperCase() + p.slice(1))
	.join('');

mkdirSync(join(dir, 'fixtures'), { recursive: true });

// ------------------------------------------------------------------ capabilities

writeFileSync(
	join(dir, 'capabilities.ts'),
	`import type { CostTable, ProviderCapabilities } from '../contract.js';

// Capabilities are DATA, not code: the router, the docs site and the /providers pages all
// render from this. Adding a capability here updates routing, validation and marketing in
// one commit.
//
// Every field must be true of the provider. \`renderJs: true\` here is a promise the live
// canary will check.

const costTable: CostTable = {
	// TODO: from the provider's pricing page, with the URL below and today's date.
	effectiveDate: '${new Date().toISOString().slice(0, 10)}',
	sourceUrl: 'TODO: link the pricing page',
	// What \`base\` counts, and it has to be right or the cost is not comparable with anybody
	// else's. \`provider-credits\` if they sell credits, \`usd-cents\` if they bill money per
	// request. Three launch providers are the former and one is the latter; mixing them silently
	// is what made X-Cost-Estimate add a credit to a fraction of a cent.
	unit: 'provider-credits',
	/**
	 * SIX CELLS, ALL REQUIRED, all zero until you read the provider's price page and replace
	 * them. There is no formula to fill in and nothing to approximate: find the published cost
	 * for each combination and write it down, or write \`null\` if they do not sell it.
	 *
	 * Zeroes here are a placeholder that \`repo:check\` will not let you ship.
	 */
	matrix: {
		none: { plain: 0, rendered: 0 },
		residential: { plain: 0, rendered: 0 },
		stealth: { plain: 0, rendered: 0 },
	},
};

export const capabilities: ProviderCapabilities = {
	id: '${id}',
	// Which categorical line colour represents this provider everywhere: the route
	// diagram, the dashboard charts, the /providers pages. A slot, never a hex.
	line: 1,
	renderJs: false,
	countryCodes: 'all',
	premiumTiers: new Set(['none']),
	sessions: false,
	// maxTimeoutMs is the budget on the LAST hop; fastTimeoutMs on a non-terminal one.
	// Get these from the provider's own documented timeout, not from a guess — the failover
	// chain's budget arithmetic depends on them.
	maxTimeoutMs: 30_000,
	fastTimeoutMs: 15_000,
	post: false,
	// Can this adapter return a body byte for byte? MEASURE IT — ask the provider for a
	// JPEG and check the first three bytes are ffd8ff. Two of the four launch providers
	// fail that: one decodes bodies as UTF-8, one wraps them in a JSON envelope. Guessing
	// true here means an image request returns 200 with a corrupted body.
	binary: false,
	costTable,
};
`,
);

// ------------------------------------------------------------------ schema

writeFileSync(
	join(dir, 'schema.ts'),
	`import { z } from 'zod';

// One Zod schema per provider. A parse failure is PROVIDER_DRIFT — a real signal that
// their API changed under us, which pages someone. Never \`as\`-cast a provider payload:
// the cast is that signal, discarded.

export const ${pascal}Response = z.object({
	// TODO: model the provider's envelope. If they return the page body raw rather than
	// wrapped in JSON, this schema describes their ERROR envelope and parse() checks the
	// content type before reaching for it.
});

export type ${pascal}Response = z.infer<typeof ${pascal}Response>;
`,
);

// ------------------------------------------------------------------ adapter

writeFileSync(
	join(dir, 'index.ts'),
	`import type {
	Adapter,
	GatewayRequest,
	ParsedResult,
	ProviderHttpRequest,
	ProviderHttpResponse,
} from '../contract.js';
import { capabilities } from './capabilities.js';

// Both functions are PURE. No I/O, no clock, no randomness — that is what lets them be
// tested against recorded bytes with nothing mocked.

function translate(req: GatewayRequest, key: string): ProviderHttpRequest {
	// Set EVERY parameter explicitly, including the ones whose default you happen to want.
	// A provider changing a default must not silently change our behaviour, and conformance
	// asserts no default leaks through.
	void req;
	void key;
	throw new Error('${id}: translate is not implemented');
}

function parse(res: ProviderHttpResponse): ParsedResult {
	// Map the response to exactly one Outcome. Do not put retry or failover logic here —
	// that is defined once, centrally, in FAILOVER. If no outcome fits, the taxonomy is
	// missing a case: add it there rather than improvising here.
	//
	// res.body is wire bytes: transfer-decoding done, charset decoding NOT done.
	void res;
	throw new Error('${id}: parse is not implemented');
}

export const ${pascal.toLowerCase() === pascal ? `${pascal}Adapter` : `${pascal}Adapter`}: Adapter = {
	capabilities,
	translate,
	parse,
};
`,
);

// ------------------------------------------------------------------ fixtures

writeFileSync(
	join(dir, 'fixtures', 'README.md'),
	`# ${id} fixtures

Empty until \`pnpm record --adapter=${id}\` runs against a trial key.

**Never hand-write a fixture.** CI cannot tell a recording from a fabrication — that check
does not exist and cannot be built — so this one is on you. A fabricated fixture makes the
entire contract-test layer decorative.

Fixtures are **post-transfer-decoding, pre-charset-decoding bytes plus all response
headers**. undici has already handled \`content-encoding\`; charset decoding has not
happened. If you are looking at a string rather than bytes, something is wrong.

The recorder drives a standard target matrix — success (HTML and JSON), target 404, target
5xx, timeout and renderJs — and sanitizes secrets before writing. Check anyway.

**There are no block or captcha fixtures here, and that is deliberate.** Neither can be
summoned from a stable target on demand, so a recorder claiming to produce them would write
a 200 labelled \`block\` — a fabrication with a plausible filename. Those come from real
traffic.
`,
);

// ------------------------------------------------------------------ registration

const registryPath = join(ADAPTERS, 'registry.ts');
const entry = `\t${id.replace(/-/g, '_')}: () => import('./${id}/index.js').then((m) => m.${pascal}Adapter),`;

if (!existsSync(registryPath)) {
	writeFileSync(
		registryPath,
		`import type { Adapter } from './contract.js';

// Every adapter, lazily loaded. Conformance is parameterized over this map, so registering
// here is what puts a new provider into the shared suite — there is no second list to
// remember.
export const REGISTRY: Record<string, () => Promise<Adapter>> = {
${entry}
};
`,
	);
} else {
	const current = readFileSync(registryPath, 'utf8');
	if (!current.includes(`'./${id}/index.js'`)) {
		writeFileSync(registryPath, current.replace(/^};$/m, `${entry}\n};`));
	}
}

// The generator writes registry.ts but cannot write the export for it: src/index.ts is
// hand-maintained and appending to it blind would fight whoever edits it next. Warn instead
// — a registry nothing exports is invisible to `pnpm record`, which is how the first adapter
// scaffolded cleanly and was then reported as "not in the registry".
const indexPath = join(ADAPTERS, 'index.ts');
if (existsSync(indexPath) && !readFileSync(indexPath, 'utf8').includes('./registry.js')) {
	process.stderr.write(
		`\n  WARNING: ${indexPath} does not export REGISTRY.\n` +
			"  Add:  export { REGISTRY } from './registry.js';\n" +
			'  Without it the adapter is registered but unreachable, and `pnpm record` will\n' +
			'  report it as unknown.\n',
	);
}

process.stdout.write(
	[
		'',
		`  scaffolded packages/adapters/src/${id}/`,
		'',
		'    capabilities.ts    what the provider can do. Data, not code',
		'    schema.ts          Zod envelope; a parse failure is PROVIDER_DRIFT',
		'    index.ts           translate + parse, both throwing until implemented',
		'    fixtures/          empty until you record',
		'',
		'  registered in packages/adapters/src/registry.ts',
		'',
		'  Next:',
		`    1. trial key, then  pnpm record --adapter=${id}`,
		`    2. implement translate/parse until  pnpm conformance --adapter=${id}  is green`,
		'    3. cost table with a source link and an effective date',
		'',
	].join('\n'),
);
