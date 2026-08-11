// Regressions for six defects an independent review panel found in the chain.
//
// Each of these passed `pnpm check` when it shipped. They are in their own file rather than
// folded into `cooldown-routing.unit.test.ts` because the point of each is the SPECIFIC wrong
// behaviour, and a reader deleting one should have to read what it cost.

import type { Adapter, Outcome, ProviderCapabilities } from '@proxlane/adapters';
import { COOLDOWN, cooldownKey, initial } from '@proxlane/shared';
import { describe, expect, it } from 'vitest';
import { runChain } from './chain.js';
import { type CooldownStore, InMemoryCooldownStore } from './cooldown-store.js';
import { type HealthStore, InMemoryHealthStore } from './health-store.js';
import type { HttpTransport } from './transport.js';

function caps(id: string): ProviderCapabilities {
	return {
		id,
		renderJs: true,
		post: true,
		sessions: true,
		countryCodes: 'all',
		premiumTiers: new Set(['none', 'residential', 'stealth']),
		fastTimeoutMs: 22_000,
		maxTimeoutMs: 75_000,
		costTable: {
			effectiveDate: '2026-08-08',
			sourceUrl: 'https://x.test/',
			base: 1,
			multipliers: {},
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
	cooldownKey('blk', { provider: p, domain: DOMAIN, org: 'self' }) as string;
const acct = (p: string) =>
	cooldownKey('acct', { provider: p, domain: DOMAIN, org: 'self' }) as string;

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

/** Put a key into the half-open state: expired, probe not yet taken. */
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
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		await chain([['a', 'PROVIDER_DRIFT']], { cooldowns: cd });
		const second = await chain([['a', 'PROVIDER_DRIFT']], { cooldowns: cd });
		if (second.outcome === 'NO_PROVIDER_AVAILABLE') {
			expect(second.retryAfterMs ?? 0).toBeGreaterThan(0);
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

	it.each(ALL)('leaves no stranded blk claim after %s', async (outcome) => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('a'));
		await chain([['a', outcome]], { cooldowns: cd });
		const e = cd.peek(blk('a'));
		// Either settled (armed afresh, or cleared away) or explicitly released. What must never
		// remain is a taken probe against an expiry in the past.
		if (e !== undefined && e.untilMs <= Date.now()) {
			expect(e.probeTaken, `${outcome} stranded the blk claim`).toBe(false);
		}
	});

	it.each(ALL)('leaves no stranded acct claim after %s', async (outcome) => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, acct('a'));
		await chain([['a', outcome]], { cooldowns: cd });
		const e = cd.peek(acct('a'));
		if (e !== undefined && e.untilMs <= Date.now()) {
			expect(e.probeTaken, `${outcome} stranded the acct claim`).toBe(false);
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

	it('still refuses when everything is cooling, demoted included', async () => {
		// The floor must not invent a provider out of a cooldown. A cooldown is a fact.
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
		expect(r.outcome).toBe('NO_PROVIDER_AVAILABLE');
		expect(r.retryAfterMs).toBeGreaterThan(0);
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
		const r = await chain([['a', 'OK']], { cooldowns: cd });
		expect(r.retryAfterMs).toBeGreaterThanOrEqual(1000);
	});

	it('reports the real wait when the cooldown has not expired', async () => {
		// The floor must not flatten a genuine wait into one second. A FIRST arm draws from
		// [0, BASE_MS), so the ceiling here is 30s rather than the 15-minute cap — the cap is
		// only reachable after several consecutive arms, or on a failed probe.
		const cd = new InMemoryCooldownStore(() => 0.999999);
		cd.arm(blk('a'), Date.now());
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
		const cd = new InMemoryCooldownStore(() => 0.9);
		expired(cd, blk('b'));
		await cd.claim(blk('b'), Date.now());
		const r = await chain(
			[
				['a', 'PROVIDER_ERROR'],
				['b', 'OK'],
			],
			{ cooldowns: cd },
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

describe('a cooldown reason names the right system', () => {
	// A `cd:acct` cooldown is a rate limit or an auth failure. Reporting it as "cooling on
	// example.com" sends the operator to debug the target instead of their provider account.
	it('says account, not domain, for a rate limit', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(acct('a'), Date.now());
		const r = await chain([['a', 'OK']], { cooldowns: cd });
		expect(r.reason).toContain('account');
		expect(r.reason).not.toContain(DOMAIN);
	});

	it('names the domain for a block', async () => {
		const cd = new InMemoryCooldownStore(() => 0.9);
		cd.arm(blk('a'), Date.now());
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
