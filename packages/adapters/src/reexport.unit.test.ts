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
import { describe, expect, it } from 'vitest';
import * as adapters from './contract.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Exports of `shared` that must NOT reach adapter authors, each with the reason.
 *
 * The reason is the point. Anything here is a considered exclusion rather than an oversight,
 * and the next person adding to `shared` has to write one too.
 */
const NOT_FOR_ADAPTERS: Record<string, string> = {
	PACKAGE_NAME: 'package identity, not API',

	// The gateway owns routing. An adapter translates and parses; it never decides whether a
	// provider is cooling, healthy, or eligible for the next hop.
	COOLDOWN: 'router state',
	arm: 'router state',
	armFor: 'router state',
	claimProbe: 'router state',
	cooldownDomain: 'router state',
	cooldownKey: 'router state',
	cooldownMs: 'router state',
	decide: 'router state',
	parseRetryAfter: 'router state',
	CooldownEntry: 'router state',
	CooldownDecision: 'router state',
	HEALTH: 'router state',
	HEALTH_FAILURE: 'router state',
	HEALTH_SUCCESS: 'router state',
	eligible: 'router state',
	healthWeight: 'router state',
	increments: 'router state',
	initial: 'router state',
	observe: 'router state',
	observeProbe: 'router state',
	orderChain: 'router state',
	probeDelayMs: 'router state',
	wilsonUpper: 'router state',
	HealthState: 'router state',

	// SSRF is enforced at the gateway edge, before any adapter is chosen. An adapter that
	// could reach this would imply it sees unguarded target URLs, which it must not.
	guardTargetUrl: 'edge guard, runs before adapter selection',
	EdgeVerdict: 'edge guard, runs before adapter selection',

	// Ids are minted by the gateway per request. An adapter minting one would produce an id
	// nothing else has ever seen.
	uuidv7: 'gateway mints request ids',
	uuidv7Time: 'gateway mints request ids',
	createIdGenerator: 'gateway mints request ids',
	requestIdFrom: 'gateway mints request ids',
	isValidRequestId: 'gateway mints request ids',
};

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
	for (const block of src.matchAll(/export type \{([^}]*)\} from '@proxlane\/shared'/g)) {
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

	it('never lists a name as both re-exported and excluded', () => {
		const both = Object.keys(NOT_FOR_ADAPTERS).filter(
			(n) => n in adapters || adapterTypeReexports().includes(n),
		);
		expect(both, `both re-exported and excluded: ${both}`).toEqual([]);
	});
});

describe('the re-exports are the same bindings', () => {
	it('re-exports identity, not a copy', () => {
		// A local re-implementation would satisfy the partition and then drift. Identity is what
		// makes `FAILOVER` the same object from either import path.
		const shipped = Object.keys(shared).filter((n) => n in adapters);
		expect(shipped.length).toBeGreaterThan(5);
		for (const name of shipped) {
			expect(
				(adapters as Record<string, unknown>)[name],
				`${name} differs between the two import paths`,
			).toBe((shared as Record<string, unknown>)[name]);
		}
	});
});
