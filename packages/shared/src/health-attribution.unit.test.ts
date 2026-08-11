// Every outcome has a health attribution, and the attribution is deliberate.
//
// `healthWeight` is typed on `Outcome`, so a misspelled member is already a compile error.
// This covers what the type cannot: that every outcome's attribution is DELIBERATE.
//
// The guard is exhaustiveness against the real `OUTCOMES` array plus a pinned expectation per
// outcome, so adding one to the union fails here until someone decides what it means for
// provider health. A new outcome silently defaulting to `ignore` is the failure mode, because
// `ignore` is the answer that never looks wrong.

import { describe, expect, it } from 'vitest';
import { HEALTH_FAILURE, HEALTH_SUCCESS, healthWeight } from './health.js';
import { OUTCOMES, type Outcome } from './outcome.js';

/**
 * The attribution table from `integrations.md` section 3, pinned.
 *
 * `ignore` is never a default here. Each one is a claim:
 *   - target facts are not provider facts, or one dead site demotes a provider for everyone
 *   - account facts are not provider facts, or one lapsed key does the same
 *   - our own bugs and the client's mistakes are not the provider's fault
 */
const EXPECTED: Record<Outcome, 'success' | 'failure' | 'ignore'> = {
	OK: 'success',
	PROVIDER_ERROR: 'failure',
	PROVIDER_DRIFT: 'failure',
	// A property of a provider AT A HOP, not of the provider. Degrading shortens its budget,
	// which raises its timeout rate, which feeds the statistic that degraded it.
	PROVIDER_TIMEOUT: 'ignore',
	// Target facts. Shared per-domain cooldown handles these; global health must not.
	SOFT_BLOCK: 'ignore',
	HARD_BLOCK: 'ignore',
	TARGET_NOT_FOUND: 'ignore',
	TARGET_ERROR: 'ignore',
	// Account facts. Launch is BYOK, so one org's lapsed key must not demote for other orgs.
	AUTH_FAILED: 'ignore',
	RATE_LIMITED: 'ignore',
	// Ours, or the client's.
	INVALID_REQUEST: 'ignore',
	BAD_REQUEST: 'ignore',
	TARGET_FORBIDDEN: 'ignore',
	NO_PROVIDER_AVAILABLE: 'ignore',
	RESPONSE_TOO_LARGE: 'ignore',
	BUDGET_EXCEEDED: 'ignore',
};

describe('health attribution covers the taxonomy', () => {
	it('has a pinned expectation for every outcome, and no extras', () => {
		// Non-zero denominator, and both directions. A table that drifted from the union would
		// otherwise pass by covering a subset.
		expect(OUTCOMES.length).toBeGreaterThan(0);
		expect(Object.keys(EXPECTED).sort()).toEqual([...OUTCOMES].sort());
	});

	it('attributes every outcome as the spec says', () => {
		for (const o of OUTCOMES) {
			expect(healthWeight(o), o).toBe(EXPECTED[o]);
		}
	});

	it('counts at least one success and one failure, or the statistic is inert', () => {
		// A CUSUM with an empty failure set never fires; with an empty success set it only ever
		// climbs. Either would make the whole health machine decorative while looking wired.
		const counted = OUTCOMES.filter((o) => healthWeight(o) !== 'ignore');
		expect(counted).toContain('OK');
		expect(counted.length).toBeGreaterThanOrEqual(2);
		expect(HEALTH_SUCCESS.length).toBeGreaterThan(0);
		expect(HEALTH_FAILURE.length).toBeGreaterThan(0);
	});

	it('names only real outcomes in the success and failure sets', () => {
		// The typo guard. `healthWeight` takes a string, so a misspelled member would simply
		// never match anything a parser emits.
		for (const o of [...HEALTH_SUCCESS, ...HEALTH_FAILURE]) {
			expect(OUTCOMES as readonly string[], `${o} is not an Outcome`).toContain(o);
		}
	});
});
