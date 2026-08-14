// The outcome class is a stability promise, so these are contract tests rather than
// coverage. What they defend: `Outcome` may grow, `OutcomeClass` may not, and a new outcome
// must land in an existing class without breaking anyone branching on the class.

import { describe, expect, it } from 'vitest';
import {
	FAILOVER,
	OUTCOME_CLASSES,
	OUTCOMES,
	type Outcome,
	type OutcomeClass,
	outcomeClass,
	outcomesInClass,
} from './outcome.js';

describe('every outcome has exactly one class', () => {
	it('assigns a known class to all of them', () => {
		expect(OUTCOMES.length).toBeGreaterThan(0);
		for (const o of OUTCOMES) {
			expect(OUTCOME_CLASSES, `${o} has an unknown class`).toContain(FAILOVER[o].class);
		}
	});

	it('leaves no class empty, so none is decoration', () => {
		// A class nobody maps to is a promise about nothing. If one empties, either the outcome
		// that used it was removed (a major) or the mapping drifted.
		for (const cls of OUTCOME_CLASSES) {
			expect(outcomesInClass(cls), `${cls} has no outcomes`).not.toHaveLength(0);
		}
	});

	it('partitions: the classes sum to exactly the taxonomy', () => {
		const total = OUTCOME_CLASSES.flatMap((c) => outcomesInClass(c));
		expect(total).toHaveLength(OUTCOMES.length);
		expect(new Set(total).size).toBe(OUTCOMES.length);
	});
});

describe('the class agrees with the policy it describes', () => {
	it('only `ok` carries a body and is chargeable', () => {
		// If a second outcome ever became chargeable, `ok` would stop meaning "you got content"
		// and every consumer branching on the class would be quietly wrong about billing.
		const chargeable = OUTCOMES.filter((o) => FAILOVER[o].chargeable === true);
		expect(chargeable).toEqual(['OK']);
		expect(outcomeClass('OK')).toBe('ok');
	});

	it('never fails over on a client fault — retrying a bad request wastes money', () => {
		for (const o of outcomesInClass('client')) {
			expect(FAILOVER[o].failover, `${o} fails over`).toBe(false);
		}
	});

	it('arms no cooldown for anything the caller or we caused', () => {
		// A cooldown punishes a provider or a domain. Neither is at fault when the request was
		// malformed or our own translation broke.
		for (const cls of ['client', 'gateway'] as const) {
			for (const o of outcomesInClass(cls)) {
				expect(FAILOVER[o].cooldown, `${o} arms a cooldown`).toBe('none');
			}
		}
	});

	it('classes `blocked` and `provider` as retryable elsewhere', () => {
		// The whole point of these two classes is "a different provider may succeed".
		for (const cls of ['blocked', 'provider'] as const) {
			for (const o of outcomesInClass(cls)) {
				expect(FAILOVER[o].failover, `${o} does not fail over`).not.toBe(false);
			}
		}
	});
});

describe('the class survives an outcome it has never heard of', () => {
	it('answers `gateway` for an unknown member rather than throwing', () => {
		// An SDK older than the gateway will see outcomes it does not know. Crashing on one
		// would make every taxonomy addition a breaking change for pinned clients, which is
		// the exact failure the class exists to prevent.
		expect(outcomeClass('SOMETHING_ADDED_IN_0_4_0')).toBe('gateway');
		expect(outcomeClass('')).toBe('gateway');
	});

	it('does not silently reclassify a real outcome', () => {
		// The fallback must not mask a mapping bug: everything real resolves to its own class.
		for (const o of OUTCOMES) {
			expect(outcomeClass(o)).toBe(FAILOVER[o].class);
		}
	});
});

describe('the mapping is pinned, because changing it is a breaking change', () => {
	// Spelled out rather than derived. A derived expectation would follow the code wherever it
	// moved and assert nothing; this fails when a member changes class, which is the event
	// that breaks a consumer's `switch`.
	const EXPECTED: Record<Outcome, OutcomeClass> = {
		OK: 'ok',
		SOFT_BLOCK: 'blocked',
		HARD_BLOCK: 'blocked',
		TARGET_NOT_FOUND: 'target',
		TARGET_ERROR: 'target',
		TARGET_RATE_LIMITED: 'target',
		PROVIDER_TIMEOUT: 'provider',
		PROVIDER_ERROR: 'provider',
		RATE_LIMITED: 'provider',
		AUTH_FAILED: 'provider',
		PROVIDER_DRIFT: 'provider',
		INVALID_REQUEST: 'gateway',
		BAD_REQUEST: 'client',
		// The SSRF edge guard, not a 403 from the site: `client`, because the caller asked for
		// a private range or a denylisted host. Reading the name alone puts it in `target`.
		TARGET_FORBIDDEN: 'client',
		NO_PROVIDER_AVAILABLE: 'gateway',
		RESPONSE_TOO_LARGE: 'gateway',
		BUDGET_EXCEEDED: 'gateway',
		// `gateway`, not `provider`, even though the status is 429 like `RATE_LIMITED`. The
		// status says what to do; the class says whose fault it is, and this one is ours.
		GATEWAY_BUSY: 'gateway',
	};

	it('matches the published mapping exactly', () => {
		for (const o of OUTCOMES) expect(outcomeClass(o), o).toBe(EXPECTED[o]);
	});
});
