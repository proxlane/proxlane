// The response analyser, against the detector it claims to run.
//
// THE FAILURE THIS GUARDS is a marketing page that says "we detect DataDome" while the thing on
// the page detects nothing, or detects it differently from the gateway. A tool whose whole pitch
// is "check us yourself" is worse than no tool if it is a reimplementation.
//
// So the coverage test is driven off `RULES`: adding a rule to the detector fails this file until
// somebody proves the page fires it. That is the assertion that actually rots.

import { RULES, SCAN_BYTES, unverifiedRules } from '@proxlane/detect';
import { policyFor } from '@proxlane/shared/outcome';
import { describe, expect, it } from 'vitest';
import { analyse, detectorRuns } from './analyse.js';

/**
 * One paste per rule, each carrying only the token that rule looks for.
 *
 * Synthetic on purpose, and NOT fixtures: a fixture is recorded wire bytes and the house rule is
 * that nobody hand-writes one. These are the minimum string that makes a documented rule fire,
 * which is the opposite claim — they assert the rule's own stated trigger, nothing about what a
 * real page looks like.
 */
const SAMPLE: Record<string, string> = {
	'cloudflare-challenge':
		'<html><head><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script></head></html>',
	'cloudflare-blocked': '<html><div class="cf-error-details">Error 1020</div></html>',
	datadome: '<html><script src="https://geo.captcha-delivery.com/captcha/"></script></html>',
	perimeterx: '<html><div id="px-captcha"></div></html>',
	'imperva-incapsula': '<html><iframe src="/_Incapsula_Resource?SWCGHOEL"></iframe></html>',
	'akamai-bot-manager': '<html><img src="https://errors.edgesuite.net/images/x.png"></html>',
};

describe('the page runs the real detector, not a description of it', () => {
	it('has a sample for every rule the detector ships', () => {
		// A new rule with no sample means the page ships a claim nobody demonstrated. This is the
		// half that cannot pass vacuously: RULES is non-empty by the detector's own tests.
		expect(RULES.length).toBeGreaterThan(0);
		expect(Object.keys(SAMPLE).sort()).toEqual(RULES.map((r) => r.id).sort());
	});

	for (const rule of RULES) {
		it(`fires ${rule.id} and names it`, () => {
			const a = analyse(SAMPLE[rule.id] as string, 'text/html');
			expect(a.ran).toBe(true);
			expect(a.outcome).toBe('SOFT_BLOCK');
			// The rule ID is the point. "Blocked" alone is what every vendor already says.
			expect(a.ruleId).toBe(rule.id);
		});
	}

	it('calls an ordinary page ordinary', () => {
		// The negative case, or every assertion above is satisfied by returning SOFT_BLOCK always.
		const a = analyse('<html><body><h1>Widgets for sale</h1></body></html>', 'text/html');
		expect(a.outcome).toBe('OK');
		expect(a.ruleId).toBeUndefined();
	});
});

describe('it never invents a block in a body the detector would skip', () => {
	// `detect` runs text rules on HTML only. An API returning JSON that happens to mention
	// `px-captcha` is not a block, and inventing one here would be a false positive advertised
	// on the page that exists to prove there are none.
	it('passes JSON through even when it carries a rule token', () => {
		const a = analyse(`{"note":${JSON.stringify(SAMPLE.datadome)}}`, 'application/json');
		expect(a.ran).toBe(false);
		expect(a.outcome).toBe('OK');
		expect(a.ruleId).toBeUndefined();
	});

	it('reports that the detector did not run, rather than reporting clean', () => {
		// `ran: false` and `blocked: false` are different facts and the UI must be able to tell
		// them apart. Collapsing them is how "we looked and it was fine" gets said about a body
		// nothing looked at.
		expect(analyse('{}', 'application/json').ran).toBe(false);
		expect(analyse('<html></html>', 'text/html').ran).toBe(true);
	});

	it('agrees with the detector about which types it reads', () => {
		// Mirrored, so it can drift. Proven by behaviour rather than by comparing two regexes:
		// a token that fires under html must not fire under a type `detectorRuns` rejects.
		for (const ct of ['text/html', 'text/plain', 'application/xml', 'application/json']) {
			expect(analyse(SAMPLE.perimeterx as string, ct).outcome).toBe(
				detectorRuns(ct) ? 'SOFT_BLOCK' : 'OK',
			);
		}
	});
});

describe('it is honest about what it read', () => {
	it('says so when the paste is longer than the detector looks', () => {
		// The gateway scans a bounded window, so a marker past it is genuinely not seen. Reporting
		// "not blocked" without saying the body was truncated would be a true statement about the
		// wrong bytes.
		const past = `${'x'.repeat(SCAN_BYTES + 10)}${SAMPLE.datadome}`;
		const a = analyse(past, 'text/html');
		expect(a.truncated).toBe(true);
		expect(a.scanned).toBe(SCAN_BYTES);
		expect(a.outcome).toBe('OK');

		// And the same marker inside the window IS seen, or the test above passes for the wrong
		// reason — a detector that never fires would satisfy it.
		expect(analyse(SAMPLE.datadome as string, 'text/html').outcome).toBe('SOFT_BLOCK');
	});

	it('counts bytes, not characters', () => {
		// A multi-byte paste under the character limit can be over the byte limit. `detect` takes
		// bytes, so a character count would report the wrong window.
		expect(analyse('é', 'text/html').bytes).toBe(2);
	});
});

describe('the consequence comes from the policy table, not from this file', () => {
	it('agrees with FAILOVER on every field it shows', () => {
		// WHAT THIS DOES NOT PROVE, said plainly because the first version of this comment claimed
		// it did: a value test cannot tell a field read from the table apart from a literal copied
		// out of it. Hardcoding `httpStatus: 502` passes this — verified by mutation. What it does
		// prove is that the page and the table agree TODAY, which catches a wrong copy but not a
		// stale one. `repo:check` assertion 36 carries the other half by banning the literals.
		const a = analyse(SAMPLE['cloudflare-challenge'] as string, 'text/html');
		const p = policyFor('SOFT_BLOCK');
		expect(a.httpStatus).toBe(p.httpStatus);
		expect(a.failover).toBe(p.failover);
		expect(a.cooldown).toBe(p.cooldown);
		expect(a.chargeable).toBe(p.chargeable);
		expect(a.class).toBe(p.class);
		expect(a.meaning).toBe(p.meaning);
	});

	it('describes a block as something the caller does not pay for and does not see', () => {
		// The pitch, stated as an assertion. A soft block must fail over and must not be
		// chargeable, or the page is selling behaviour the gateway does not have.
		const a = analyse(SAMPLE.datadome as string, 'text/html');
		expect(a.failover).toBe(true);
		expect(a.chargeable).toBe(false);
		expect(a.cooldown).not.toBe('none');
	});
});

describe('the page can tell the truth about rule provenance', () => {
	it('exposes which rules have never seen a real capture', () => {
		// `state.md` records that the detector has never seen a real block page. The page says so
		// out loud rather than implying six battle-tested rules, and this asserts the list it
		// prints is the detector's own rather than a stale copy.
		const unverified = unverifiedRules();
		expect(new Set(unverified).size).toBe(unverified.length);
		for (const id of unverified) expect(RULES.some((r) => r.id === id)).toBe(true);
	});
});
