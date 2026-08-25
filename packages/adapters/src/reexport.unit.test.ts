// `contract.ts` promises that "an adapter author imports everything from `@proxlane/adapters`
// and never needs to know" the taxonomy lives in `shared`. That re-export is a hand-written
// list, so the promise decays every time `shared` gains an export and nobody remembers.
//
// It has decayed twice. `outcomeClass` was added and the gateway stopped compiling against
// `@proxlane/adapters` — the adapter author's own import path. Then `errorBody` landed and
// nothing would have caught it, because the first version of this file only knew about names
// matching the taxonomy.
//
// So this does not check a list of names anyone has to remember. It PARTITIONS: every export
// `shared` has is either on the adapter surface or explicitly not, with a reason. Adding
// anything to `shared` fails here until that decision is made.
//
// `export *` would also never drift, and is rejected deliberately: it would put the env
// schema, the edge guard and the cooldown and health internals onto a published Apache-2.0
// surface, where removing one later becomes a breaking change for adapters.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shared from '@proxlane/shared';
import * as errorBody from '@proxlane/shared/error-body';
import * as outcome from '@proxlane/shared/outcome';
import { describe, expect, it } from 'vitest';
import * as adapters from './contract.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Why a `shared` export is kept off the adapter surface.
 *
 * Grouped rather than repeated per name. The reason is the point — anything excluded is a
 * considered decision rather than an oversight — but repeating one string twenty-four times
 * made it look like twenty-four decisions, and rewording it touched twenty-four lines.
 */
const REASONS = {
	/**
	 * The gateway owns routing. An adapter translates a request and parses a response; it
	 * never decides whether a provider is cooling, healthy, or eligible for the next hop.
	 */
	ROUTER_STATE: 'router state: the gateway decides routing, adapters translate and parse',
	/**
	 * SSRF is enforced at the gateway edge, before any adapter is chosen. An adapter able to
	 * reach this would imply it sees unguarded target URLs, which it must not.
	 */
	EDGE_GUARD: 'edge guard: runs before adapter selection',
	/**
	 * Adapters are pure and total: `translate` is handed a key, it never fetches one. Reading
	 * `process.env` inside an adapter would end the property the entire test strategy rests
	 * on — that conformance can exercise every adapter against recorded fixtures with a
	 * placeholder credential, which is what lets a stranger contribute one without holding a
	 * provider account.
	 */
	ENV_READ: 'reads process.env: adapters are handed a key, they never fetch one',
	/**
	 * How much memory a DEPLOYMENT needs is a property of the gateway's configuration — its
	 * concurrency ceiling and body cap — not of any adapter. An adapter that could read this
	 * would be reading the operator's container limit, which is none of its business.
	 */
	SIZING: 'deployment sizing: a property of the gateway process, not of an adapter',
	/**
	 * Ids are minted once per request by the gateway. An adapter minting one would produce an
	 * id that appears in no log and joins to no row.
	 */
	REQUEST_ID: 'request identity: minted once by the gateway',
	/** Not API. */
	NOT_API: 'package identity, not API',
} as const;

/**
 * Exports of `shared` that must NOT reach adapter authors, grouped by why.
 *
 * A list of groups rather than a flat map, so the count is checkable: `Object.fromEntries`
 * silently keeps the last value when a name appears twice, which would hide a name being
 * moved between groups without being removed from the old one.
 */
const EXCLUSIONS: ReadonlyArray<readonly [reason: string, names: readonly string[]]> = [
	[REASONS.NOT_API, ['PACKAGE_NAME']],
	[
		REASONS.ROUTER_STATE,
		[
			'COOLDOWN',
			'CooldownDecision',
			'CooldownEntry',
			// The premium ladder and the tier-cooling rule. Router state by the same argument as
			// the rest of this group: an adapter declares WHICH tiers it sells, and the chain
			// decides what a block at one of them implies for the others. An adapter that could
			// read the ladder would be tempted to reason about a sibling tier's cooldown, which is
			// the chain's job and the chain's alone.
			'TIER_LADDER',
			'tiersAtOrBelow',
			'HEALTH',
			'HEALTH_FAILURE',
			'HEALTH_SUCCESS',
			'HealthState',
			'arm',
			'armFor',
			'claimProbe',
			'cooldownDomain',
			'cooldownKey',
			'cooldownMs',
			'decide',
			'eligible',
			'forcedProbeKey',
			'healthWeight',
			'increments',
			'initial',
			'maxCapForKey',
			'observe',
			'observeProbe',
			'orderChain',
			'parseRetryAfter',
			'probeCeilingMs',
			'probeDelayMs',
			'wilsonUpper',
		],
	],
	[REASONS.EDGE_GUARD, ['EdgeVerdict', 'guardTargetUrl']],
	[REASONS.ENV_READ, ['providerKeyFromEnv']],
	[
		REASONS.SIZING,
		[
			'BUFFER_FACTOR',
			'CGROUP_V1_PATH',
			'CGROUP_V2_PATH',
			'LIMIT_ENV',
			'MemoryBudget',
			'MemoryLimit',
			'MemorySource',
			'assessMemory',
			'budgetMb',
			'describeSource',
			'overBudgetMessage',
			'readMemoryLimit',
		],
	],
	[
		REASONS.REQUEST_ID,
		['createIdGenerator', 'isValidRequestId', 'requestIdFrom', 'uuidv7', 'uuidv7Time'],
	],
];

const NOT_FOR_ADAPTERS: Record<string, string> = Object.fromEntries(
	EXCLUSIONS.flatMap(([reason, names]) => names.map((n) => [n, reason])),
);

/** Type-only exports never appear at runtime, so they are read out of the source. */
function sharedTypeExports(): string[] {
	const dir = join(ROOT, 'packages/shared/src');
	const names = new Set<string>();
	for (const file of readdirSync(dir)) {
		if (!file.endsWith('.ts') || file.includes('.test.')) continue;
		for (const m of readFileSync(join(dir, file), 'utf8').matchAll(
			/^export (?:type|interface) ([A-Za-z0-9_]+)/gm,
		)) {
			if (m[1] !== undefined) names.add(m[1]);
		}
	}
	return [...names].sort();
}

/** Names `contract.ts` re-exports as types, which `import *` cannot see either. */
function adapterTypeReexports(): string[] {
	const src = readFileSync(join(ROOT, 'packages/adapters/src/contract.ts'), 'utf8');
	const names = new Set<string>();
	// ANY shared specifier, barrel or subpath. `contract.ts` re-exports from
	// `@proxlane/shared/outcome` and `@proxlane/shared/error-body` now — the barrel drags
	// `node:crypto` into anything that loads it, which killed hydration once it reached the web
	// app through this package. Anchoring on the bare barrel made this partition silently empty.
	for (const block of src.matchAll(/export type \{([^}]*)\} from '@proxlane\/shared[^']*'/g)) {
		for (const raw of (block[1] ?? '').split(',')) {
			const n = raw.trim();
			if (n !== '') names.add(n);
		}
	}
	return [...names].sort();
}

describe('every shared export is classified, so the list cannot drift', () => {
	it('partitions the runtime exports', () => {
		const all = Object.keys(shared);
		expect(all.length, 'read no exports — this check proved nothing').toBeGreaterThan(10);
		const unclassified = all.filter((n) => !(n in adapters) && !(n in NOT_FOR_ADAPTERS));
		expect(
			unclassified,
			`shared exports these and nothing decided about them. Re-export from ` +
				`contract.ts, or add to NOT_FOR_ADAPTERS with a reason: ${unclassified.join(', ')}`,
		).toEqual([]);
	});

	it('partitions the type-only exports', () => {
		// The half `import *` cannot see, and the half that broke first: `ErrorBody` is a type,
		// so a missing re-export is invisible at runtime and only fails in a consumer's build.
		const types = sharedTypeExports();
		expect(types.length, 'parsed no type exports').toBeGreaterThan(5);
		const reexported = new Set(adapterTypeReexports());
		const unclassified = types.filter((n) => !reexported.has(n) && !(n in NOT_FOR_ADAPTERS));
		expect(
			unclassified,
			`shared exports these TYPES and nothing decided about them: ${unclassified.join(', ')}`,
		).toEqual([]);
	});

	it('keeps the exclusion list honest', () => {
		// An entry for something shared no longer exports is stale, and would silently excuse a
		// future export that happens to reuse the name.
		const live = new Set([...Object.keys(shared), ...sharedTypeExports()]);
		const stale = Object.keys(NOT_FOR_ADAPTERS).filter((n) => !live.has(n));
		expect(stale, `NOT_FOR_ADAPTERS names things shared no longer exports: ${stale}`).toEqual(
			[],
		);
	});

	it('lists no name in two exclusion groups', () => {
		// Object.fromEntries keeps the last value silently, so a name moved between groups but
		// left in the old one would carry the wrong reason and nothing would say so.
		const flat = EXCLUSIONS.flatMap(([, names]) => names);
		const dupes = flat.filter((n, i) => flat.indexOf(n) !== i);
		expect(dupes, `listed in more than one group: ${[...new Set(dupes)].join(', ')}`).toEqual(
			[],
		);
		expect(Object.keys(NOT_FOR_ADAPTERS)).toHaveLength(flat.length);
	});

	it('gives every group a distinct, non-empty reason', () => {
		const reasons = EXCLUSIONS.map(([r]) => r);
		expect(new Set(reasons).size, 'two groups share a reason — merge them').toBe(
			reasons.length,
		);
		for (const r of reasons) expect(r.length).toBeGreaterThan(10);
	});

	it('never lists a name as both re-exported and excluded', () => {
		const both = Object.keys(NOT_FOR_ADAPTERS).filter(
			(n) => n in adapters || adapterTypeReexports().includes(n),
		);
		expect(both, `both re-exported and excluded: ${both}`).toEqual([]);
	});
});

describe('the re-exports are the same bindings', () => {
	it('re-exports identity, not a copy', () => {
		// A local re-implementation would satisfy the partition above and then drift. Identity is
		// what makes `FAILOVER` the same object however you reach it.
		//
		// COMPARED AGAINST THE SUBPATHS `contract.ts` ACTUALLY IMPORTS, which is a change worth
		// explaining. It used to compare against the `@proxlane/shared` barrel, and that stopped
		// working when contract moved to `@proxlane/shared/outcome` and `/error-body` — the
		// barrel re-exports `id.ts`, which imports `node:crypto`, and pulling it through this
		// package into `apps/web` killed hydration site-wide.
		//
		// Under vitest a barrel import and a subpath import resolve to different module
		// instances, so comparing across them measures the RESOLVER rather than this package.
		// (That was already true of `/outcome` before this change; the test only passed because
		// contract happened to use the same path it did.) The built artifact does share: node
		// against `dist/` reports `index.mjs` and `outcome.mjs` and `error-body.mjs` all handing
		// back the same objects, because tsdown code-splits them.
		//
		// So this asserts the thing that is ours to get wrong: contract re-exports the binding it
		// imported, rather than cloning it.
		const sources: Record<string, unknown> = { ...outcome, ...errorBody };
		const shipped = Object.keys(sources).filter((n) => n in adapters);
		expect(shipped.length).toBeGreaterThan(5);
		for (const name of shipped) {
			expect(
				(adapters as Record<string, unknown>)[name],
				`${name} is a copy, not the binding contract.ts imported`,
			).toBe(sources[name]);
		}
	});
});
