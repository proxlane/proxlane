// Regressions for six defects an independent review panel found in the chain.
//
// Each of these passed `pnpm check` when it shipped. They are in their own file rather than
// folded into `cooldown-routing.unit.test.ts` because the point of each is the SPECIFIC wrong
// behaviour, and a reader deleting one should have to read what it cost.

import type { Adapter, Outcome, ProviderCapabilities } from '@proxlane/adapters';
import { COOLDOWN, cooldownKey, forcedProbeKey, initial } from '@proxlane/shared';
import type { HttpTransport } from '@proxlane/shared/transport';
import { describe, expect, it } from 'vitest';
import { runChain } from './chain.js';
import { type CooldownStore, InMemoryCooldownStore } from './cooldown-store.js';
import { type HealthStore, InMemoryHealthStore } from './health-store.js';

function caps(id: string): ProviderCapabilities {
	return {
		line: 1,
		id,
		renderJs: true,
		waitForSelector: true,
		post: true,
		binary: false,
		sessions: true,
		countryCodes: 'all',
		premiumTiers: new Set(['none', 'residential', 'stealth']),
		fastTimeoutMs: 22_000,
		maxTimeoutMs: 75_000,
		costTable: {
			effectiveDate: '2026-08-08',
			sourceUrl: 'https://x.test/',
			unit: 'provider-credits',
			matrix: {
				none: { plain: 1, rendered: 1 },
				residential: { plain: 1, rendered: 1 },
				stealth: { plain: 1, rendered: 1 },
			},
		},
	};
}

function adapterFor(id: string, outcome: Outcome): Adapter {
	return {
		capabilities: caps(id),
		translate: () => ({
			url: `https://${id}.test/`,
			method: 'GET',
			headers: {},
			timeoutMs: 1000,
		}),
		parse: () => ({
			outcome,
			cost: { microcredits: 0, source: 'estimated' },
			...(outcome === 'OK'
				? { body: new TextEncoder().encode('<html>ok</html>'), contentType: 'text/html' }
				: {}),
		}),
	} as Adapter;
}

const okTransport: HttpTransport = {
	execute: () =>
		Promise.resolve({
			kind: 'response' as const,
			latencyMs: 5,
			response: { status: 200, headers: {}, body: new Uint8Array() },
		}),
};

const DOMAIN = 'target.example';
const REQ = {
	url: `https://${DOMAIN}/page`,
	method: 'GET' as const,
	renderJs: false,
	premium: 'none' as const,
	deadlineMs: 90_000,
};

const blk = (p: string) =>
	cooldownKey('blk', { provider: p, domain: DOMAIN, org: 'self', premium: 'none' }) as string;
const acct = (p: string) =>
	cooldownKey('acct', { provider: p, domain: DOMAIN, org: 'self', premium: 'none' }) as string;

/** A health store reporting fixed states, so a test names a situation instead of simulating it. */
function healthOf(states: Record<string, 'healthy' | 'degraded' | 'demoted'>): HealthStore {
	return {
		snapshot: (ids) =>
			Promise.resolve(
				new Map(
					ids.map((id) => [id, { ...initial(0), state: states[id] ?? 'healthy', p0: 0.04 }]),
				),
			),
		record: () => {},
		recordProbe: () => {},
		all: () => Promise.resolve(new Map()),
	};
}

function chain(
	specs: [string, Outcome][],
	over: Partial<Parameters<typeof runChain>[1]> = {},
	transport: HttpTransport = okTransport,
) {
	return runChain(REQ, {
		transport,
		candidates: specs.map(([id, o]) => ({ adapter: adapterFor(id, o), key: 'k' })),
		maxBodyBytes: 1024 * 1024,
		...over,
	});
}

// Elapsed-time assertions carry SLACK_MS, because `before` is captured before the code under
// test runs and the arm lands a millisecond or two later. Two of these failed in CI at
// exactly bound+1 while passing locally. The bounds are still tight enough to distinguish
// the source of the duration, which is what each test is actually about.
const SLACK_MS = 2_000;

/** Put a key into the half-open state: expired, probe not yet taken. */
/**
 * Take the forced-probe slot, so the chain reaches the REFUSAL path.
 *
 * Every test below is about what the refusal says. Since the cooldown floor landed, an
 * all-cooling domain gets one forced attempt first, so without this they exercise the forced
 * path instead and assert against a served response. Consuming the slot is not a workaround:
 * it is the genuine precondition for the refusal, and the same thing the tests already do to
 * `blk('a')` to reach the all-cooling state at all.
 */
function forcedSlotTaken(cd: InMemoryCooldownStore): void {
	cd.arm(forcedProbeKey(DOMAIN), Date.now());
}

function expired(cd: InMemoryCooldownStore, key: string): void {
	cd.arm(key, Date.now() - COOLDOWN.CAP_MS * 3);
}

describe('a claimed probe is always settled', () => {
	// THE DEFECT: the claim was released only by `arm` (an outcome with a cooldown scope) or by
	// `clear` (an outcome of exactly OK). Every other outcome left `probeTaken: true` against an
	// expiry already in the past. `decide()` then reported `cooling` forever, the provider was
	// filtered out of every subsequent request, and the 503 carried `Retry-After: 0` — a
	// hot-loop instruction — until the record's TTL lapsed an hour later.
	//
	// One 404 on a probe request did that.
	const strandingOutcomes: Outcome[] = [
		'TARGET_ERROR',
		'PROVIDER_DRIFT',
		'RESPONSE_TOO_LARGE',
		'INVALID_REQUEST',
	];

	it.each(strandingOutcomes)('releases the probe after %s', async (outcome) => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		await chain([['a', outcome]], { cooldowns: cd });
		expect(cd.peek(blk('a'))?.probeTaken, `${outcome} stranded the probe`).toBe(false);
	});

	it('leaves the provider usable on the very next request', async () => {
		// The consequence, end to end: without the release this second call returns
		// NO_PROVIDER_AVAILABLE with Retry-After: 0.
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		await chain([['a', 'TARGET_ERROR']], { cooldowns: cd });
		const second = await chain([['a', 'OK']], { cooldowns: cd });
		expect(second.outcome).toBe('OK');
		expect(second.provider).toBe('a');
	});

	it('never advertises Retry-After: 0, which is a hot loop', async () => {
		// A CONDITIONAL EXPECTATION IS A SKIPPED EXPECTATION. This body used to reach zero
		// `expect` calls: the guard was `if (second.outcome === 'NO_PROVIDER_AVAILABLE')` and
		// the second attempt does not produce that outcome, so vitest reported "passed" for a
		// test that asserted nothing — in the regressed state exactly as in the fixed one.
		expect.hasAssertions();
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		await chain([['a', 'PROVIDER_DRIFT']], { cooldowns: cd });
		const second = await chain([['a', 'PROVIDER_DRIFT']], { cooldowns: cd });
		// Unconditional, and true of every outcome: a Retry-After is either absent or useful.
		// Zero is the one value that is worse than absent, because a caller believes it and
		// comes straight back.
		if (second.retryAfterMs !== undefined) {
			expect(second.retryAfterMs, `${second.outcome} advertised a zero wait`).toBeGreaterThan(
				0,
			);
		} else {
			expect(second.retryAfterMs).toBeUndefined();
		}
	});

	it('releases even when the transport throws', async () => {
		// The reason settlement is in a `finally` rather than after the outcome switch.
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		const throwing: HttpTransport = {
			execute: () => Promise.reject(new Error('socket died')),
		};
		await chain([['a', 'OK']], { cooldowns: cd }, throwing).catch(() => undefined);
		expect(cd.peek(blk('a'))?.probeTaken).toBe(false);
	});

	it('still arms on a real block, rather than releasing', async () => {
		// Settling must not become "always release": a probe that confirms the block has to
		// re-arm, and at the cap.
		const before = Date.now();
		const cd = new InMemoryCooldownStore(() => 0.0001);
		expired(cd, blk('a'));
		await chain([['a', 'HARD_BLOCK']], { cooldowns: cd });
		const e = cd.peek(blk('a'));
		expect(e?.probeTaken).toBe(false);
		expect((e?.untilMs ?? 0) - before).toBeGreaterThan(COOLDOWN.CAP_MS * 0.9);
	});
});

describe('settlement compares the key CLAIMED to the key WRITTEN', () => {
	// The first fix set `settled = true` whenever the attempt wrote any cooldown key. The two
	// keys are frequently in different namespaces, so eight of the sixteen outcomes stranded
	// the claim anyway — including a SUCCESSFUL probe on an account claim, which takes a
	// working provider out of service for an hour.
	//
	// The first regression suite could not see any of it: it only ever armed `blk`, and only
	// iterated outcomes whose cooldown scope is `none`. Both halves of that blind spot are
	// covered here — every outcome, against both namespaces.
	const ALL: Outcome[] = [
		'OK',
		'SOFT_BLOCK',
		'HARD_BLOCK',
		'TARGET_NOT_FOUND',
		'TARGET_ERROR',
		'PROVIDER_TIMEOUT',
		'PROVIDER_ERROR',
		'RATE_LIMITED',
		'AUTH_FAILED',
		'PROVIDER_DRIFT',
		'INVALID_REQUEST',
		'BAD_REQUEST',
		'TARGET_FORBIDDEN',
		'NO_PROVIDER_AVAILABLE',
		'RESPONSE_TOO_LARGE',
		'BUDGET_EXCEEDED',
	];

	// SIXTEEN CASES EACH, AND NOTHING PROVED ANY OF THEM REACHED THE ASSERTION. The claim was
	// guarded by `if (e !== undefined && e.untilMs <= Date.now())`, so a change that stopped
	// leaving an expired entry behind would empty every case and all 32 would still report
	// passed. Both branches now assert, and `expect.hasAssertions()` fails a body that reaches
	// neither — which is exactly what it did for four of the sixteen `acct` cases.
	it.each(ALL)('leaves no stranded blk claim after %s', async (outcome) => {
		expect.hasAssertions();
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		await chain([['a', outcome]], { cooldowns: cd });
		const e = cd.peek(blk('a'));
		// Either settled (armed afresh, or cleared away) or explicitly released. What must never
		// remain is a taken probe against an expiry in the past.
		if (e !== undefined && e.untilMs <= Date.now()) {
			expect(e.probeTaken, `${outcome} stranded the blk claim`).toBe(false);
		} else {
			// Settled. Assert that explicitly rather than falling out of the body silently.
			expect(e === undefined || e.untilMs > Date.now()).toBe(true);
		}
	});

	it.each(ALL)('leaves no stranded acct claim after %s', async (outcome) => {
		expect.hasAssertions();
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, acct('a'));
		await chain([['a', outcome]], { cooldowns: cd });
		const e = cd.peek(acct('a'));
		if (e !== undefined && e.untilMs <= Date.now()) {
			expect(e.probeTaken, `${outcome} stranded the acct claim`).toBe(false);
		} else {
			// Settled. Asserted explicitly rather than falling out of the body — four outcomes
			// take this branch, and under the old conditional they were 4 of 16 cases reporting
			// "passed" having evaluated nothing at all.
			expect(e === undefined || e.untilMs > Date.now()).toBe(true);
		}
	});

	it('keeps a provider in service after a successful probe on an ACCOUNT cooldown', async () => {
		// The worst case, end to end. Request 1 probes and succeeds; requests 2 and 3 must not
		// then be refused. Before the fix they were 503 until the hourly sweep.
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, acct('a'));
		const first = await chain([['a', 'OK']], { cooldowns: cd });
		expect(first.outcome).toBe('OK');
		for (const n of [2, 3]) {
			const r = await chain([['a', 'OK']], { cooldowns: cd });
			expect(r.outcome, `request ${n} was refused after a successful probe`).toBe('OK');
		}
	});
});

describe('a concurrent success does not destroy an account cooldown', () => {
	// THE DEFECT: `OK` cleared BOTH the domain and the account key. `cd:acct` is not
	// domain-scoped, so any concurrent request coming back OK deleted the rate-limit backoff
	// another request had just armed — `consecutive` included, so the exponent never climbed.
	//
	// That is the steady state of a provider plan concurrency cap: some requests 429 while
	// others succeed. The account cooldown was armed and destroyed continuously and never once
	// took effect.
	it('leaves cd:acct alone when a CONCURRENT request succeeds', async () => {
		// The first version of this test armed the key, then ran a second request and checked
		// the key survived. It could not fail: an armed account cooldown filters the provider
		// out, so the second request never reached an OK and never called `clear`. Reverting
		// the fix left it green.
		//
		// The real shape is concurrent. Request A passes the cooldown check while the key is
		// clear, and request B arms it while A is still in flight. Modelled here by arming from
		// inside the transport, which is exactly "the key was armed after we looked".
		const cd = new InMemoryCooldownStore(() => 0.9);
		const armsMidFlight: HttpTransport = {
			execute: () => {
				cd.arm(acct('a'), Date.now());
				return Promise.resolve({
					kind: 'response' as const,
					latencyMs: 5,
					response: { status: 200, headers: {}, body: new Uint8Array() },
				});
			},
		};
		const r = await chain([['a', 'OK']], { cooldowns: cd }, armsMidFlight);
		expect(r.outcome).toBe('OK');
		expect(
			cd.peek(acct('a')),
			'the succeeding request deleted a rate-limit backoff armed by another',
		).toBeDefined();
	});

	it('keeps the backoff exponent, which a clear would reset to zero', async () => {
		// `clear` is a DELETE, so it takes `consecutive` with it. Under a plan concurrency cap
		// — some 429, some fine — the exponent would be destroyed on every success and the
		// backoff would never climb past its first step.
		const cd = new InMemoryCooldownStore(() => 0.9);
		for (let i = 0; i < 3; i++) cd.arm(acct('a'), Date.now() - 1);
		const before = cd.peek(acct('a'))?.consecutive ?? 0;
		expect(before).toBe(3);
		const armsMidFlight: HttpTransport = {
			execute: () => {
				cd.arm(acct('a'), Date.now());
				return Promise.resolve({
					kind: 'response' as const,
					latencyMs: 5,
					response: { status: 200, headers: {}, body: new Uint8Array() },
				});
			},
		};
		await chain([['a', 'OK']], { cooldowns: cd }, armsMidFlight);
		expect(cd.peek(acct('a'))?.consecutive ?? 0).toBeGreaterThanOrEqual(before);
	});

	it('still clears the domain key on success', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		await chain([['a', 'OK']], { cooldowns: cd });
		expect(cd.peek(blk('a'))).toBeUndefined();
	});

	it('clears the domain key on a genuine 404 too, because the provider reached the target', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		await chain([['a', 'TARGET_NOT_FOUND']], { cooldowns: cd });
		expect(cd.peek(blk('a'))).toBeUndefined();
	});
});

describe('the demoted floor survives cooldown filtering', () => {
	// THE DEFECT: cooldowns were read only for providers that survived health ranking, and
	// ranking drops demoted providers. So a healthy-but-cooling provider emptied the chain
	// while a demoted-but-perfectly-usable one was never considered. The floor exists
	// precisely to stop the gateway turning itself off, and cooldown filtering routed past it.
	it('uses a demoted provider when the healthy one is cooling', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blk('a'), Date.now());
		const r = await chain(
			[
				['a', 'OK'],
				['b', 'OK'],
			],
			{ cooldowns: cd, health: healthOf({ a: 'healthy', b: 'demoted' }) },
		);
		expect(r.outcome).toBe('OK');
		expect(r.provider).toBe('b');
		expect(r.providerHealth).toBe('demoted-forced');
	});

	it('does not let the DEMOTED floor resurrect a cooling provider', async () => {
		// The original defect, and the assertion that still matters: the demoted floor must not
		// invent a provider out of a cooldown.
		//
		// It used to be checked as "everything cooling means NO_PROVIDER_AVAILABLE", which is no
		// longer the whole truth — the cooldown floor now forces one rate-limited attempt rather
		// than take a domain off the air for the length of a grown backoff. So the property is
		// asserted directly instead: whatever gets used here is used BECAUSE of the cooldown
		// floor and says so, not because the demoted floor quietly ignored a cooldown.
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blk('a'), Date.now());
		cd.arm(blk('b'), Date.now());
		const r = await chain(
			[
				['a', 'OK'],
				['b', 'OK'],
			],
			{ cooldowns: cd, health: healthOf({ a: 'healthy', b: 'demoted' }) },
		);
		expect(r.providerHealth).toBe('cooling-forced');
		expect(r.providerHealth).not.toBe('demoted-forced');
		// And it is rate-limited: the next request gets the honest refusal. A FRESH store with
		// blocked adapters, because a forced probe that SUCCEEDS clears the cooldown outright —
		// reusing the store above would test the block-lifted path by accident.
		const cd2 = new InMemoryCooldownStore(() => 0.9);
		cd2.arm(blk('a'), Date.now());
		cd2.arm(blk('b'), Date.now());
		const health = healthOf({ a: 'healthy', b: 'demoted' });
		const one = await chain(
			[
				['a', 'HARD_BLOCK'],
				['b', 'HARD_BLOCK'],
			],
			{ cooldowns: cd2, health },
		);
		expect(one.attempts).toHaveLength(1);
		const two = await chain(
			[
				['a', 'HARD_BLOCK'],
				['b', 'HARD_BLOCK'],
			],
			{ cooldowns: cd2, health },
		);
		expect(two.outcome).toBe('NO_PROVIDER_AVAILABLE');
		expect(two.retryAfterMs).toBeGreaterThan(0);
	});
});

describe('the timeout cap follows health, not position', () => {
	// THE DEFECT: `isLastHop ? maxTimeoutMs : fastTimeoutMs`. `orderChain` puts the least
	// healthy member LAST, so the terminal hop's 75s went to the worst provider while healthy
	// ones got 22s — a 3.4x promotion for the least reliable member, which both the module
	// docstring and integrations.md claimed the design avoided.
	it('gives a degraded provider the fast cap even in the terminal hop', async () => {
		const r = await chain(
			[
				['a', 'PROVIDER_ERROR'],
				['b', 'PROVIDER_ERROR'],
			],
			{ health: healthOf({ a: 'healthy', b: 'degraded' }) },
		);
		const terminal = r.attempts[r.attempts.length - 1];
		expect(terminal?.provider, 'the degraded provider should be last').toBe('b');
		expect(terminal?.budgetMs).toBeLessThanOrEqual(22_000);
	});

	it('still gives a healthy terminal hop the full cap', async () => {
		const r = await chain([['a', 'PROVIDER_ERROR']], {});
		expect(r.attempts[0]?.budgetMs).toBeGreaterThan(22_000);
	});

	it('gives a forced provider the fast cap', async () => {
		// `demoted-forced` means every capable provider was demoted. Handing the one we were
		// told is dead the largest possible budget is the worst of both.
		const r = await chain([['a', 'PROVIDER_ERROR']], { health: healthOf({ a: 'demoted' }) });
		expect(r.providerHealth).toBe('demoted-forced');
		expect(r.attempts[0]?.budgetMs).toBeLessThanOrEqual(22_000);
	});
});

describe('an exhausted chain says so', () => {
	// THE DEFECT: the fallthrough was labelled "unreachable" and returned `lastOutcome`. A lost
	// probe claim `continue`s, so exiting the loop normally IS reachable, and the chain then
	// reported the previous provider's failure with no provider attached — a response whose
	// X-Outcome names a provider fault while X-Provider-Used is absent.
	it('returns NO_PROVIDER_AVAILABLE, not the previous provider failure', async () => {
		// A provider whose probe is already out with another request reports `cooling`, so it
		// is filtered before the loop and this is the all-cooling path. The fallthrough below
		// covers the narrower race where the claim is lost between `check` and `claim`.
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		await cd.claim(blk('a'), Date.now());
		forcedSlotTaken(cd);
		const r = await chain([['a', 'OK']], { cooldowns: cd });
		expect(r.outcome).toBe('NO_PROVIDER_AVAILABLE');
		expect(r.attempts).toHaveLength(0);
		expect(r.provider).toBeUndefined();
	});

	it('advertises a wait of at least a second, never zero', async () => {
		// The expiry is already in the PAST here — the cooldown lapsed and its probe is out with
		// someone else — so `soonest - now()` is negative. Clamped to 0 it becomes
		// `Retry-After: 0`, which is a hot loop instruction on the one response whose entire
		// job is to say "wait".
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		await cd.claim(blk('a'), Date.now());
		forcedSlotTaken(cd);
		const r = await chain([['a', 'OK']], { cooldowns: cd });
		expect(r.retryAfterMs).toBeGreaterThanOrEqual(1000);
	});

	it('reports the real wait when the cooldown has not expired', async () => {
		// The floor must not flatten a genuine wait into one second. A FIRST arm draws from
		// [0, BASE_MS), so the ceiling here is 30s rather than the 15-minute cap — the cap is
		// only reachable after several consecutive arms, or on a failed probe.
		const cd = new InMemoryCooldownStore(() => 0.999999);
		cd.arm(blk('a'), Date.now());
		forcedSlotTaken(cd);
		const r = await chain([['a', 'OK']], { cooldowns: cd });
		expect(r.retryAfterMs).toBeGreaterThan(25_000);
		expect(r.retryAfterMs).toBeLessThanOrEqual(COOLDOWN.BASE_MS);
	});
});

describe('a lost probe claim does not hide the demoted fallback', () => {
	// The floor drops demoted providers before the chain is walked, but a probe claim is only
	// resolved AT attempt time. So a request whose claim is lost used to `continue` off the end
	// of a one-element chain while a demoted-but-perfectly-open provider sat unconsidered —
	// the same failure the floor exists to prevent, arriving through the one cooldown fact
	// resolved after ranking.
	//
	// It needs genuine concurrency: sequentially the second request reads `cooling` and routes
	// correctly, which is why the earlier suite could not see it.
	it('falls back to a demoted provider when the healthy one loses its claim', async () => {
		const inner = new InMemoryCooldownStore(() => 0.9);
		expired(inner, blk('a'));

		// Both requests read the cooldown state before either claims, which is what two
		// concurrent requests actually do.
		let released: (() => void) | undefined;
		const gate = new Promise<void>((r) => {
			released = r;
		});
		let firstCheck = true;
		const racing: CooldownStore = {
			check: async (keys, now) => {
				const snapshot = await inner.check(keys, now);
				if (firstCheck) {
					firstCheck = false;
				} else {
					// The second request's read completes only after the first has claimed, but it
					// carries the state it observed BEFORE that — a stale `probe`.
					await gate;
				}
				return snapshot;
			},
			claim: async (key, now) => {
				const got = await inner.claim(key, now);
				released?.();
				return got;
			},
			arm: (k, n) => inner.arm(k, n),
			clear: (k) => inner.clear(k),
			release: (k) => inner.release(k),
			list: (n) => inner.list(n),
		};

		const deps = {
			cooldowns: racing,
			health: healthOf({ a: 'healthy', b: 'demoted' }),
		};
		const [first, second] = await Promise.all([
			chain(
				[
					['a', 'OK'],
					['b', 'OK'],
				],
				deps,
			),
			chain(
				[
					['a', 'OK'],
					['b', 'OK'],
				],
				deps,
			),
		]);

		// One of them probed `a`. The other must have been served by the demoted `b`, not
		// refused — `b` was open, capable and usable the whole time.
		const outcomes = [first.outcome, second.outcome];
		expect(outcomes, 'a usable demoted provider was never considered').not.toContain(
			'NO_PROVIDER_AVAILABLE',
		);
		expect([first.provider, second.provider].sort()).toEqual(['a', 'b']);
	});

	it('does not re-attempt a provider when the chain is re-ranked', async () => {
		// Re-ranking restarts the walk, so anything already tried has to be excluded or a
		// failover would pay for the same provider twice.
		//
		// `terminalRetries: 0` because the terminal retry is the OTHER, deliberate way the same
		// provider gets attempted twice, and it would satisfy this assertion by accident — `a`
		// ends up alone in the chain here, which makes it the terminal hop. Leaving it on would
		// turn a regression test into a test of two features at once, and it would go green for
		// the wrong reason on the day the re-rank bug came back.
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('b'));
		await cd.claim(blk('b'), Date.now());
		const r = await chain(
			[
				['a', 'PROVIDER_ERROR'],
				['b', 'OK'],
			],
			{ cooldowns: cd, terminalRetries: 0 },
		);
		const tried = r.attempts.map((x) => x.provider);
		expect(new Set(tried).size, `a provider was attempted twice: ${tried.join(', ')}`).toBe(
			tried.length,
		);
	});
});

describe('a target 429 backs off instead of retrying into a ban', () => {
	// The outcome exists for this. As TARGET_ERROR a target 429 armed NOTHING — it failed over
	// once and the next request repeated the whole thing immediately. Repeatedly ignoring a
	// rate limit is what turns it into a ban, and we would be doing it on the operator's own
	// provider account.
	//
	// Providers already retry a target 429 internally first (ScraperAPI for up to 60s across
	// its pool, uncharged), so one that reaches us has already outlasted that.
	it('arms the DOMAIN cooldown, which TARGET_ERROR did not', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		await chain([['a', 'TARGET_RATE_LIMITED']], { cooldowns: cd });
		expect(cd.peek(blk('a')), 'no backoff was armed').toBeDefined();
		expect(
			cd.peek(acct('a')),
			'a target fact must not touch the account namespace',
		).toBeUndefined();
	});

	it('skips that provider for that domain on the next request', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		await chain(
			[
				['a', 'TARGET_RATE_LIMITED'],
				['b', 'OK'],
			],
			{ cooldowns: cd },
		);
		const second = await chain(
			[
				['a', 'OK'],
				['b', 'OK'],
			],
			{ cooldowns: cd },
		);
		expect(second.provider, 'the throttled provider was tried again immediately').toBe('b');
	});

	it('leaves other domains alone', async () => {
		// A rate limit is a property of the target, so it must not remove the provider from
		// every other site the moment one starts throttling.
		const cd = new InMemoryCooldownStore(() => 0.9);
		await chain([['a', 'TARGET_RATE_LIMITED']], { cooldowns: cd });
		const other = await runChain(
			{ ...REQ, url: 'https://elsewhere.example/x' },
			{
				transport: okTransport,
				candidates: [{ adapter: adapterFor('a', 'OK'), key: 'k' }],
				maxBodyBytes: 1024,
				cooldowns: cd,
			},
		);
		expect(other.provider).toBe('a');
	});

	it('fails over rather than stopping, because another provider is another egress', async () => {
		const r = await chain([
			['a', 'TARGET_RATE_LIMITED'],
			['b', 'OK'],
		]);
		expect(r.outcome).toBe('OK');
		expect(r.provider).toBe('b');
	});

	it('carries no health weight, so one throttling site cannot demote a provider', async () => {
		const store = new InMemoryHealthStore();
		for (let i = 0; i < 5000; i++) store.record('a', 'TARGET_RATE_LIMITED', 1000 + i);
		expect(
			(await store.all(0)).get('a')?.p0,
			'a target fact reached the statistic',
		).toBeFalsy();
	});
});

describe("the cooldown honours the target's Retry-After", () => {
	// Measured, not assumed: against a target sending `Retry-After: 120`, ScrapingBee forwards
	// it as `spb-retry-after` and Scrapfly exposes it in the envelope, while ScraperAPI strips
	// it entirely. So it is absent more often than present and the fallback is the common path.
	const withRetryAfter = (id: string, outcome: Outcome, retryAfterMs?: number): Adapter =>
		({
			capabilities: caps(id),
			translate: () => ({
				url: `https://${id}.test/`,
				method: 'GET',
				headers: {},
				timeoutMs: 1000,
			}),
			parse: () => ({
				outcome,
				cost: { microcredits: 0, source: 'estimated' },
				...(retryAfterMs === undefined ? {} : { retryAfterMs }),
			}),
		}) as Adapter;

	it('waits as long as the target asked, not for a jittered guess', async () => {
		// The jitter is pinned near zero, so anything near two minutes can only have come from
		// the header. A first arm otherwise draws from [0, 30s).
		const cd = new InMemoryCooldownStore(() => 0.0001);
		const before = Date.now();
		await runChain(REQ, {
			transport: okTransport,
			candidates: [{ adapter: withRetryAfter('a', 'TARGET_RATE_LIMITED', 120_000), key: 'k' }],
			maxBodyBytes: 1024,
			cooldowns: cd,
		});
		// A RANGE, not an exact bound. `before` is captured before the chain runs, so the arm
		// lands a millisecond or two later and `<= 120_000` failed in CI at 120001 while
		// passing locally. What the test is for is distinguishing the header from the jitter,
		// and the jitter's whole range is [0, 30s) — so anything near two minutes settles it.
		const until = cd.peek(blk('a'))?.untilMs ?? 0;
		expect(until - before).toBeGreaterThan(110_000);
		expect(until - before).toBeLessThan(130_000);
	});

	it('falls back to the backoff when the provider strips it', async () => {
		// ScraperAPI's case, and the common one.
		const cd = new InMemoryCooldownStore(() => 0.9);
		const before = Date.now();
		await runChain(REQ, {
			transport: okTransport,
			candidates: [{ adapter: withRetryAfter('a', 'TARGET_RATE_LIMITED'), key: 'k' }],
			maxBodyBytes: 1024,
			cooldowns: cd,
		});
		const until = cd.peek(blk('a'))?.untilMs ?? 0;
		expect(until - before).toBeGreaterThan(0);
		expect(until - before).toBeLessThanOrEqual(COOLDOWN.BASE_MS + SLACK_MS);
	});

	it('clamps an absurd request to the cap', async () => {
		const cd = new InMemoryCooldownStore(() => 0.5);
		const before = Date.now();
		await runChain(REQ, {
			transport: okTransport,
			candidates: [
				{ adapter: withRetryAfter('a', 'TARGET_RATE_LIMITED', 7 * 24 * 3600_000), key: 'k' },
			],
			maxBodyBytes: 1024,
			cooldowns: cd,
		});
		expect((cd.peek(blk('a'))?.untilMs ?? 0) - before).toBeLessThanOrEqual(
			COOLDOWN.CAP_MS + SLACK_MS,
		);
	});

	it('applies to any cooling outcome, not just a 429', async () => {
		// A provider rate limit carries one too, and `cd:acct` deserves the same honesty.
		const cd = new InMemoryCooldownStore(() => 0.0001);
		const before = Date.now();
		await runChain(REQ, {
			transport: okTransport,
			candidates: [{ adapter: withRetryAfter('a', 'RATE_LIMITED', 90_000), key: 'k' }],
			maxBodyBytes: 1024,
			cooldowns: cd,
		});
		const acctUntil = (cd.peek(acct('a'))?.untilMs ?? 0) - before;
		expect(acctUntil).toBeGreaterThan(80_000);
		expect(acctUntil).toBeLessThan(100_000);
	});
});

describe('the store picks the ceiling from the key, not one ceiling for all', () => {
	// `maxCapForKey` being right is worth nothing if the STORE does not pass it. Reverting that
	// argument left every other test green, because the shared tests call `arm` directly.
	it('grows a settled BLOCK cooldown past the flat cap', () => {
		const cd = new InMemoryCooldownStore(() => 0.5);
		const key = blk('a');
		// Drive it into probe-failure territory: expired each time, so every arm is a re-arm
		// after a failed probe, which is the path that uses the ceiling.
		for (let i = 0; i < 12; i++) cd.arm(key, Date.now() - 10_000_000);
		const before = Date.now();
		cd.arm(key, before);
		expect((cd.peek(key)?.untilMs ?? 0) - before).toBe(COOLDOWN.MAX_CAP_MS);
	});

	it('leaves a settled ACCOUNT cooldown at the flat cap', () => {
		const cd = new InMemoryCooldownStore(() => 0.5);
		const key = acct('a');
		for (let i = 0; i < 12; i++) cd.arm(key, Date.now() - 10_000_000);
		const before = Date.now();
		cd.arm(key, before);
		expect((cd.peek(key)?.untilMs ?? 0) - before).toBe(COOLDOWN.CAP_MS);
	});
});

describe('a cooldown reason names the right system', () => {
	// A `cd:acct` cooldown is a rate limit or an auth failure. Reporting it as "cooling on
	// example.com" sends the operator to debug the target instead of their provider account.
	it('says account, not domain, for a rate limit', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(acct('a'), Date.now());
		forcedSlotTaken(cd);
		const r = await chain([['a', 'OK']], { cooldowns: cd });
		expect(r.reason).toContain('account');
		expect(r.reason).not.toContain(DOMAIN);
	});

	it('names the domain for a block', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blk('a'), Date.now());
		forcedSlotTaken(cd);
		const r = await chain([['a', 'OK']], { cooldowns: cd });
		expect(r.reason).toContain(DOMAIN);
	});
});

describe('a throwing release cannot break a request', () => {
	it('settles best-effort', async () => {
		// The first version of this test could not fail: its store returned `open` for every
		// key, so no probe was ever claimed and `release` was never called. It passed with the
		// try/catch deleted. The store now reports a genuine half-open probe, so the release
		// path is actually entered.
		let released = 0;
		const broken: CooldownStore = {
			check: (keys) =>
				Promise.resolve(new Map(keys.map((k) => [k, { kind: 'probe' as const }]))),
			claim: () => Promise.resolve(true),
			arm: () => {},
			clear: () => {},
			release: () => {
				released++;
				throw new Error('release failed');
			},
			list: () => Promise.resolve([]),
		};
		// TARGET_ERROR settles neither namespace, so the claim must be released.
		await expect(chain([['a', 'TARGET_ERROR']], { cooldowns: broken })).resolves.toMatchObject({
			outcome: 'TARGET_ERROR',
		});
		expect(released, 'release was never reached, so this test proves nothing').toBeGreaterThan(
			0,
		);
	});
});

describe('an answered request keeps its answer when the chain runs out', () => {
	// CHAIN [a, b], a ANSWERS, b's PROBE CLAIM IS LOST to a concurrent request. The walk exits
	// normally with attempts recorded, and the exhausted-chain return reported `lastOutcome` —
	// the NAME of a's outcome and nothing else. So a caller who had a real answer, with a body
	// and a detect rule attached, received the outcome stripped of all of it: no
	// `X-Provider-Used`, no `X-Detect-Rule`, no body, on a response whose `X-Outcome` named a
	// provider fault.
	//
	// THE RACE HAS TO HAPPEN DURING THE WALK, which the first version of this test got wrong.
	// Taking b's probe slot up front excludes it at snapshot time, so the chain is [a] alone and
	// the in-loop return fires — the mutation survived and the test still passed. The real
	// sequence is: b looks claimable when the snapshot is taken, and the claim fails when the
	// chain reaches it. That is a store whose `check` and `claim` disagree, which is exactly
	// what concurrency produces.
	function losesClaimFor(inner: InMemoryCooldownStore, provider: string): CooldownStore {
		return {
			check: (keys, now) => inner.check(keys, now),
			claim: (key, now) =>
				key === blk(provider) ? Promise.resolve(false) : inner.claim(key, now),
			arm: (key, now, retryAfterMs) => inner.arm(key, now, retryAfterMs),
			clear: (key) => inner.clear(key),
			release: (key) => inner.release(key),
			list: (now) => inner.list(now),
		};
	}

	it('returns the full result, not just the outcome name', async () => {
		const inner = new InMemoryCooldownStore(() => 0.9);
		// `b` is half-open: expired, probe not taken — so the snapshot offers it.
		expired(inner, blk('b'));

		const r = await chain(
			[
				['a', 'SOFT_BLOCK'],
				['b', 'OK'],
			],
			{ cooldowns: losesClaimFor(inner, 'b') },
		);

		// The walk really did run out rather than returning from inside the loop.
		expect(r.reason, 'this did not exercise the exhausted-chain path').toBe('chain exhausted');
		expect(r.outcome, 'the outcome a produced').toBe('SOFT_BLOCK');
		expect(r.provider, 'the provider that produced it went missing').toBe('a');
		expect(r.attempts.map((x) => x.provider)).toEqual(['a']);
		// The payload the caller had already been given, and which used to be dropped.
		expect(r.result, 'the parsed result went missing').toBeDefined();
	});

	it('still reports NO_PROVIDER_AVAILABLE when nothing was ever attempted', async () => {
		// The other direction, so "return the last completed result" cannot be satisfied by
		// returning a stale one. With no attempt at all there is nothing to report but this.
		const inner = new InMemoryCooldownStore(() => 0.9);
		expired(inner, blk('a'));
		const r = await chain([['a', 'OK']], { cooldowns: losesClaimFor(inner, 'a') });
		expect(r.attempts.length).toBe(0);
		expect(r.outcome).toBe('NO_PROVIDER_AVAILABLE');
		expect(r.provider).toBeUndefined();
	});
});

describe('a throwing health store cannot make the chain retry a provider', () => {
	// `unusable.add` sat INSIDE the try that exists to swallow a throwing `record` — so it was
	// skipped in exactly the case the try was written for, and which "failed the first time it
	// was tested".
	//
	// IT ONLY BITES ON A RE-RANK, which is what makes it reachable rather than theoretical. A
	// lost probe claim does `unusable.add(that provider); ranked = rank(); i = -1; continue` —
	// it restarts the walk from the top of a freshly ranked chain. Any provider missing from
	// `unusable` comes back, so a provider already attempted and already PAID FOR is attempted a
	// second time. Chain [a, b]: a fails and its record throws, b's claim is lost, the walk
	// restarts, and a is charged twice.
	it('marks a provider attempted even when record() throws', async () => {
		const throwing: HealthStore = {
			...healthOf({}),
			record: () => {
				throw new Error('health store is down');
			},
		};
		const inner = new InMemoryCooldownStore(() => 0.9);
		// `b` is half-open, so the chain tries to claim its probe slot and loses it.
		expired(inner, blk('b'));
		const losing: CooldownStore = {
			check: (keys, now) => inner.check(keys, now),
			claim: (key, now) => (key === blk('b') ? Promise.resolve(false) : inner.claim(key, now)),
			arm: (key, now, retryAfterMs) => inner.arm(key, now, retryAfterMs),
			clear: (key) => inner.clear(key),
			release: (key) => inner.release(key),
			list: (now) => inner.list(now),
		};

		const r = await chain(
			[
				['a', 'PROVIDER_ERROR'],
				['b', 'OK'],
			],
			{ cooldowns: losing, health: throwing },
		);

		// `a` was tried exactly once. Twice means the re-rank walked back over it.
		expect(
			r.attempts.filter((x) => x.provider === 'a').length,
			'a was attempted more than once, so the chain paid twice for the same failure',
		).toBe(1);
	});
});

describe('a challenge page is a block whatever status it arrived with', () => {
	// REPORTED BY A REAL CALLER, which is why it is here rather than in a design note. Their
	// Cloudflare-defended target answered a 5xx to all four providers; proxlane returned
	// TARGET_ERROR — "the site is broken" — when the truth was that the site's defences refused
	// every provider. Cloudflare's under-attack mode answers 503, so this is the ordinary shape of
	// the thing this product exists to name.
	//
	// It costs more than a wrong label: TARGET_ERROR is `cooldown: 'none'`, so nothing is
	// remembered and every later request re-buys the same four failures.
	// THIS ASSERTS THE WIRING, NOT THE FINGERPRINT, and the distinction matters here.
	//
	// A first version hand-wrote plausible-looking Cloudflare markup and the rule correctly did
	// not fire — the house rule ("never hand-write a fixture") catching a hand-written fixture.
	// Whether the signature is real is settled elsewhere, against captures in the private corpus,
	// and `verified.ts` records which rules a stored capture has confirmed.
	//
	// What is asserted here is that the CHAIN consults the detector for a target 5xx at all, which
	// it did not. So the body carries the exact token `cloudflare-challenge` matches, read off the
	// rule rather than invented, and the test says plainly that it is testing plumbing.
	const CHALLENGE =
		'<html><head><title>Just a moment...</title></head><body>' +
		'<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>' +
		'</body></html>';

	function transportReturning(status: number, body: string, ct = 'text/html'): HttpTransport {
		return {
			execute: () =>
				Promise.resolve({
					kind: 'response' as const,
					latencyMs: 5,
					response: {
						status,
						headers: { 'content-type': ct },
						body: new TextEncoder().encode(body),
					},
				}),
		};
	}

	it('re-labels a TARGET_ERROR whose body is a challenge page', async () => {
		const r = await chain([['a', 'TARGET_ERROR']], {}, transportReturning(503, CHALLENGE));
		expect(r.outcome, 'a challenge behind a 5xx still read as a target fault').toBe(
			'SOFT_BLOCK',
		);
		expect(r.detectRuleId, 'no rule id, so the caller cannot see why').toBeDefined();
	});

	it('arms a cooldown for it, which TARGET_ERROR does not', async () => {
		// The half that costs money. Without this the same four providers are paid again on every
		// request, forever, against a domain we already know is defended.
		const cd = new InMemoryCooldownStore(() => 0.9);
		await chain([['a', 'TARGET_ERROR']], { cooldowns: cd }, transportReturning(503, CHALLENGE));
		expect(cd.peek(blk('a')), 'a defended domain was not remembered').toBeDefined();
	});

	it('leaves an ordinary target 5xx alone', async () => {
		// The other direction, and the one that keeps this honest. A genuinely broken origin is a
		// target fault and must not be called a block.
		const r = await chain(
			[['a', 'TARGET_ERROR']],
			{},
			transportReturning(503, '<html><body>Service Unavailable</body></html>'),
		);
		expect(r.outcome).toBe('TARGET_ERROR');
		expect(r.detectRuleId).toBeUndefined();
	});

	it('leaves a 404 alone even when its body carries a vendor token', async () => {
		// Deliberately excluded. A 404 is the target's real answer; re-labelling one because the
		// not-found page happens to carry a token would fail over to fetch the same 404 again.
		const r = await chain([['a', 'TARGET_NOT_FOUND']], {}, transportReturning(404, CHALLENGE));
		expect(r.outcome).toBe('TARGET_NOT_FOUND');
	});
});

describe('a claimed success that returned nothing is not a success', () => {
	// A real caller's provider answered 200 with zero bytes after 37 seconds. `OK` is
	// `chargeable: true`, so that was billed and reported as a successful scrape.
	it('calls an empty body a block, with the rule id attached', async () => {
		const empty: HttpTransport = {
			execute: () =>
				Promise.resolve({
					kind: 'response' as const,
					latencyMs: 5,
					response: {
						status: 200,
						headers: { 'content-type': 'text/html' },
						body: new Uint8Array(),
					},
				}),
		};
		// The stub adapter reports OK and hands back the bytes it was given.
		const okEmpty = {
			capabilities: adapterFor('a', 'OK').capabilities,
			translate: () => ({
				url: 'https://a.test/',
				method: 'GET' as const,
				headers: {},
				timeoutMs: 1000,
			}),
			parse: (res: { body: Uint8Array }) => ({
				outcome: 'OK' as const,
				body: res.body,
				contentType: 'text/html',
				cost: { microcredits: 0, source: 'estimated' as const },
			}),
		} as unknown as Adapter;

		const r = await runChain(REQ, {
			transport: empty,
			candidates: [{ adapter: okEmpty, key: 'k' }],
			maxBodyBytes: 1024 * 1024,
		});
		expect(r.outcome, 'zero bytes was billed as a successful scrape').toBe('SOFT_BLOCK');
		expect(r.detectRuleId).toBe('empty-response');
	});
});

describe('a cooldown degrades the chain, it does not truncate it', () => {
	// THE BUG THAT COST A REAL CALLER A WORKING SOURCE. Their chain was
	// [scrapfly, scrapingbee, brightdata] because ScraperAPI happened to be cooling. All three
	// refused, the walk ended, and the request returned TARGET_ERROR — having never tried the one
	// provider that could serve it. They concluded the site was blocked at every tier. It was
	// blocked at every tier the gateway was willing to try, and a later request with the cooldown
	// expired succeeded on ScraperAPI at the cheapest rate.
	//
	// The floor already existed for "every capable provider is cooling", with the stated reason
	// that it only fires "where the alternative was serving nothing". That is equally true here;
	// the trigger was narrower than the reasoning.
	it('tries a cooled provider when every provider it walked failed', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		// `a` is cooling. `b` is not, and fails.
		cd.arm(blk('a'), Date.now());

		const r = await chain(
			[
				['a', 'OK'],
				['b', 'PROVIDER_ERROR'],
			],
			{ cooldowns: cd },
		);

		expect(r.outcome, 'gave up with a cooled provider untried').toBe('OK');
		expect(r.provider).toBe('a');
		expect(r.providerHealth, 'the forced attempt is not labelled as such').toBe(
			'cooling-forced',
		);
		// `['b', 'b', 'a']` — b, b's terminal retry, then the forced a. Asserted as properties
		// rather than a literal sequence: the retry count is configurable
		// (PROXLANE_TERMINAL_RETRIES, default 1), and pinning the list makes this a test of that
		// setting instead of of the forced attempt.
		const tried = r.attempts.map((x) => x.provider);
		expect(tried[tried.length - 1], 'the forced provider was not tried last').toBe('a');
		expect(tried.filter((x) => x === 'a').length, 'forced more than once').toBe(1);
	});

	it('forces at most one, however many are cooling', async () => {
		// The herd guard. The forced slot is per DOMAIN and claimed once, so a chain that fails
		// everywhere does not walk every cooled provider at full price.
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blk('a'), Date.now());
		cd.arm(blk('b'), Date.now());

		const r = await chain(
			[
				['a', 'PROVIDER_ERROR'],
				['b', 'PROVIDER_ERROR'],
				['c', 'PROVIDER_ERROR'],
			],
			{ cooldowns: cd },
		);
		// `c` is the only non-cooling one; then exactly ONE cooled provider is forced, never
		// both. Counted as distinct cooled providers rather than total attempts, which also
		// carry c's terminal retry.
		const cooledTried = new Set(
			r.attempts.map((x) => x.provider).filter((id) => id === 'a' || id === 'b'),
		);
		expect(cooledTried.size, 'more than one cooled provider was forced').toBe(1);
	});

	it('does not force when the walk succeeded', async () => {
		// The obvious direction, and the one that keeps this from costing money on every request.
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blk('a'), Date.now());
		const r = await chain(
			[
				['a', 'OK'],
				['b', 'OK'],
			],
			{ cooldowns: cd },
		);
		expect(r.outcome).toBe('OK');
		expect(r.provider).toBe('b');
		expect(r.attempts.length).toBe(1);
	});

	it('does not force when nothing was ever attempted', async () => {
		// That case belongs to the pre-walk floor, which claims the same slot. Forcing here too
		// would take the slot twice for one request.
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blk('a'), Date.now());
		forcedSlotTaken(cd);
		const r = await chain([['a', 'OK']], { cooldowns: cd });
		expect(r.attempts.length).toBe(0);
		expect(r.outcome).toBe('NO_PROVIDER_AVAILABLE');
	});
});

describe('the last-resort attempt is bounded by more than the claim', () => {
	// WITH A STORE THAT ALWAYS GRANTS THE CLAIM. Both guards below are masked in normal use,
	// because arming the forced key makes the second claim fail on its own — so a mutation that
	// removed either survived every test until this one. A store that never refuses separates the
	// claim from the logic it is protecting.
	function alwaysClaims(inner: InMemoryCooldownStore): CooldownStore {
		return {
			check: (keys, now) => inner.check(keys, now),
			claim: () => Promise.resolve(true),
			arm: (key, now, retryAfterMs) => inner.arm(key, now, retryAfterMs),
			clear: (key) => inner.clear(key),
			release: (key) => inner.release(key),
			list: (now) => inner.list(now),
		};
	}

	it('never re-forces a provider it has already attempted', async () => {
		// The pre-walk floor forces one cooled provider in when everything is cooling. If it fails,
		// the exhaustion path must not pick the same one again — `unusable` is what prevents that,
		// and without the filter the chain pays twice for one provider's refusal.
		const inner = new InMemoryCooldownStore(() => 0.9);
		inner.arm(blk('a'), Date.now());
		inner.arm(blk('b'), Date.now());

		const r = await chain(
			[
				['a', 'PROVIDER_ERROR'],
				['b', 'PROVIDER_ERROR'],
			],
			{ cooldowns: alwaysClaims(inner) },
		);

		const tried = r.attempts.map((x) => x.provider);
		const distinct = new Set(tried);
		expect(distinct.size, 'a provider was forced twice').toBe(
			tried.length - countRetries(tried),
		);
	});

	it('forces at most once per request even when the claim always succeeds', async () => {
		// `exhaustionForced` is the guard. Without it the walk would force every cooled provider
		// in turn, which is the herd the single slot exists to prevent, reintroduced inside one
		// request instead of across many.
		const inner = new InMemoryCooldownStore(() => 0.9);
		for (const id of ['a', 'b', 'c']) inner.arm(blk(id), Date.now());

		const r = await chain(
			[
				['a', 'PROVIDER_ERROR'],
				['b', 'PROVIDER_ERROR'],
				['c', 'PROVIDER_ERROR'],
			],
			{ cooldowns: alwaysClaims(inner) },
		);

		// One from the pre-walk floor, one from exhaustion. Never all three.
		const distinct = new Set(r.attempts.map((x) => x.provider));
		expect(distinct.size, 'every cooled provider was forced').toBeLessThanOrEqual(2);
	});
});

/** How many entries are a terminal retry of the entry before them. */
function countRetries(tried: readonly string[]): number {
	return tried.filter((id, i) => i > 0 && tried[i - 1] === id).length;
}

describe('a block at one tier is not a block at all of them', () => {
	// THE CHEAP PATH POISONED THE EXPENSIVE ONE. `cd:blk` was keyed {provider}:{domain} with no
	// tier, so a plain request that got blocked cooled that provider for that domain across every
	// tier — suppressing the stealth retry, which is the escalation most likely to work and the
	// whole reason the tier exists.
	//
	// Measured against a real host: plain probes blocked, and a `premium=stealth` follow-up was
	// SKIPPED rather than tried. It read as "stealth does not work here" when stealth had never
	// been sent.
	const req = (premium: 'none' | 'residential' | 'stealth') => ({ ...REQ, premium });

	function chainAt(
		premium: 'none' | 'residential' | 'stealth',
		specs: [string, Outcome][],
		cooldowns: CooldownStore,
	) {
		return runChain(req(premium), {
			transport: okTransport,
			candidates: specs.map(([id, o]) => ({ adapter: adapterFor(id, o), key: 'k' })),
			maxBodyBytes: 1024 * 1024,
			cooldowns,
		});
	}

	it('does not let a plain block suppress a stealth attempt', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		// A plain request blocks `a`.
		await chainAt('none', [['a', 'HARD_BLOCK']], cd);
		expect(cd.peek(blk('a')), 'the plain block was not recorded').toBeDefined();

		// The escalation must still be tried, not skipped.
		const r = await chainAt('stealth', [['a', 'OK']], cd);
		expect(r.outcome, 'stealth was suppressed by a plain block').toBe('OK');
		expect(r.provider).toBe('a');
	});

	it('lets a stealth block cool the weaker tiers too', async () => {
		// The other direction, and it must hold: if the strongest setting could not get through,
		// paying for the cheaper ones is paying to rediscover a known answer.
		const cd = new InMemoryCooldownStore(() => 0.9);
		await chainAt('stealth', [['a', 'HARD_BLOCK']], cd);

		for (const tier of ['none', 'residential', 'stealth'] as const) {
			const key = cooldownKey('blk', {
				provider: 'a',
				domain: DOMAIN,
				org: 'self',
				premium: tier,
			}) as string;
			expect(cd.peek(key), `${tier} was not cooled by a stealth block`).toBeDefined();
		}
	});

	it('leaves the stronger tiers alone when the weak one blocks', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		await chainAt('none', [['a', 'HARD_BLOCK']], cd);

		const stealthKey = cooldownKey('blk', {
			provider: 'a',
			domain: DOMAIN,
			org: 'self',
			premium: 'stealth',
		}) as string;
		expect(cd.peek(stealthKey), 'a plain block cooled the stealth tier').toBeUndefined();
	});
});
