// `contract.ts` promises that "an adapter author imports everything from `@proxlane/adapters`
// and never needs to know" the taxonomy lives in `shared`. That re-export is a hand-written
// list, so the promise decays every time `shared` gains an export and nobody remembers.
//
// It decayed immediately: `outcomeClass` was added to `shared` and the gateway failed to
// compile against `@proxlane/adapters`, which is the adapter author's own import path. A
// stranger writing an adapter would have hit the same wall with less context.
//
// This asserts the surface instead of trusting the comment.

import * as shared from '@proxlane/shared';
import { describe, expect, it } from 'vitest';
import * as adapters from './contract.js';

/**
 * Everything from `shared` that an adapter author legitimately needs.
 *
 * Not "every export in shared": that package also holds the env schema, the edge guard,
 * health and cooldown internals, none of which belong on the authoring surface. The rule is
 * the taxonomy and the request shape — what `parse` returns and `translate` receives.
 */
const REQUIRED = [
	'OUTCOMES',
	'OUTCOME_CLASSES',
	'FAILOVER',
	'policyFor',
	'shouldFailover',
	'cooldownScope',
	'carriesBody',
	'outcomeClass',
	'outcomesInClass',
] as const;

describe('the adapter authoring surface is complete', () => {
	it('re-exports every taxonomy value an adapter author needs', () => {
		const missing = REQUIRED.filter((name) => !(name in adapters));
		expect(missing, `not re-exported from @proxlane/adapters: ${missing.join(', ')}`).toEqual(
			[],
		);
	});

	it('re-exports the identical binding, not a copy', () => {
		// A local re-implementation would pass the presence check and then drift. Identity is
		// what makes `FAILOVER` from either import path the same object.
		for (const name of REQUIRED) {
			expect(
				(adapters as Record<string, unknown>)[name],
				`${name} differs between the two import paths`,
			).toBe((shared as Record<string, unknown>)[name]);
		}
	});

	it('catches a NEW taxonomy export that nobody re-exported', () => {
		// The general case, so the next addition fails here rather than in a consumer's build.
		// Scoped to outcome-taxonomy names, since shared deliberately keeps internals private
		// to the authoring surface.
		const taxonomyish = Object.keys(shared).filter(
			(k) => /^OUTCOME/.test(k) || /^outcome/.test(k) || k === 'FAILOVER',
		);
		expect(taxonomyish.length).toBeGreaterThan(0);
		const missing = taxonomyish.filter((k) => !(k in adapters));
		expect(missing, `shared exports these, @proxlane/adapters does not: ${missing}`).toEqual(
			[],
		);
	});
});
