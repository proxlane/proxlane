// Where provider health lives between requests.
//
// `packages/shared/src/health.ts` is the pure state machine: given a state and an outcome it
// produces the next state. This is the I/O half — read it before a routing decision, fold an
// outcome into it afterwards.
//
// WHY IN-MEMORY IS THE RIGHT ANSWER TODAY, and not a placeholder with a nicer name.
//
// Launch is self-host: one compose file, one gateway process, provider keys in its
// environment. Health is process-local because the process IS the deployment. Nothing in the
// gateway speaks to Valkey yet — cooldowns are unimplemented too — so reaching for it here
// would add a hot-path round trip, a failure mode and a dependency to solve a problem
// (a second replica) that hosted brings and self-host does not.
//
// WHAT THAT COSTS, stated rather than discovered:
//
//   - Health resets on restart. Every provider re-enters measurement and cannot be demoted
//     for MIN_SAMPLES observations. This is the same state a Valkey cold start produces, and
//     `integrations.md` section 3 already documents that as the correct failure direction: a
//     gateway that forgets a provider was demoted routes to it again, whereas one that
//     forgot it was healthy would not.
//   - Two replicas would keep two opinions and demote independently. There is no second
//     replica, and `assertSingleWriter` below refuses to pretend otherwise.
//
// The interface is async and the Valkey implementation is a swap, not a rewrite.

import type { Outcome } from '@proxlane/adapters';
import { type HealthState, initial, observe, observeProbe } from '@proxlane/shared';

export interface HealthStore {
	/**
	 * State for each provider, for a routing decision. Providers with no history read as
	 * freshly initialised rather than being absent, so callers never branch on undefined.
	 *
	 * May reject. The chain fails OPEN on a rejection — routes as if everything is healthy —
	 * which is the row `integrations.md` section 3 adds to the Valkey-failure table.
	 */
	snapshot(ids: readonly string[], now: number): Promise<ReadonlyMap<string, HealthState>>;

	/**
	 * Fold one attempt's outcome in.
	 *
	 * Returns `void`, not a promise, and that is deliberate: the hot path must not be able to
	 * await it by accident. Recording is best-effort and off the critical path — a lost
	 * observation costs a little sensitivity, whereas a round trip per attempt spends the
	 * latency budget that `operations.md` section 9 gates on. An implementation that needs
	 * I/O buffers internally and reports its own failures.
	 */
	record(providerId: string, outcome: Outcome, now: number): void;

	/** Fold a background probe result in. The only thing that lifts a demoted provider. */
	recordProbe(providerId: string, ok: boolean, now: number): void;

	/** Everything known, for `/health/providers`. */
	all(now: number): Promise<ReadonlyMap<string, HealthState>>;
}

/**
 * Process-local health. Correct for a single-process deployment, wrong for two, and the
 * difference is enforced rather than documented — see `assertSingleWriter`.
 */
export class InMemoryHealthStore implements HealthStore {
	readonly #states = new Map<string, HealthState>();

	#get(id: string, now: number): HealthState {
		const existing = this.#states.get(id);
		if (existing !== undefined) return existing;
		const fresh = initial(now);
		this.#states.set(id, fresh);
		return fresh;
	}

	snapshot(ids: readonly string[], now: number): Promise<ReadonlyMap<string, HealthState>> {
		return Promise.resolve(new Map(ids.map((id) => [id, this.#get(id, now)])));
	}

	record(providerId: string, outcome: Outcome, now: number): void {
		this.#states.set(providerId, observe(this.#get(providerId, now), outcome, now));
	}

	recordProbe(providerId: string, ok: boolean, now: number): void {
		this.#states.set(providerId, observeProbe(this.#get(providerId, now), ok, now));
	}

	all(_now: number): Promise<ReadonlyMap<string, HealthState>> {
		return Promise.resolve(new Map(this.#states));
	}
}

/**
 * Refuse to boot a second replica against a process-local store.
 *
 * Two gateways with in-memory health form two opinions of the same provider and demote
 * independently, so a provider can be out of rotation on one replica and first in the chain
 * on the other. Nothing about that is visible in a log or a metric; it looks like flaky
 * routing.
 *
 * This is the failure a comment does not prevent. Whoever first scales the gateway will be
 * reading a compose file, not this module, so the check names the fix at the moment it
 * becomes wrong: run one replica, or land the Valkey store first.
 */
export function assertSingleWriter(replicas: number): void {
	if (replicas > 1) {
		throw new Error(
			`PROXLANE_REPLICAS=${replicas}, but provider health is stored in-process.\n\n` +
				'  Two replicas keep two opinions of the same provider and demote independently,\n' +
				'  so one may route to a provider the other has taken out of rotation.\n\n' +
				'  Run a single gateway, or implement the Valkey-backed HealthStore first.\n',
		);
	}
}
