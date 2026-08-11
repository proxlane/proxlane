// The background probe. The only thing that lifts a demoted provider.
//
// `integrations.md` section 3: recovery is probe-only, never live traffic. Without this, a
// demoted provider stays demoted until the process restarts — which is why health shipped
// with a documented hole rather than a feature.
//
// WHY IT LIVES IN THE GATEWAY AND NOT IN `apps/worker`.
//
// The plan puts queues in a worker, and this is not a queue. It is a scheduled read-modify
// -write against health state, and health state is process-local unless PROXLANE_VALKEY_URL
// is set. A separate worker process could not see the gateway's state in the default
// deployment, so it would either be inert or force Valkey to be mandatory. Creating
// `apps/worker` to hold something that cannot work there is the "worker registering zero
// queues" that CLAUDE.md calls a running lie.
//
// It belongs to whoever owns the state. Today that is the gateway.
//
// WHAT IT COSTS. One request per demoted provider per interval, against a stable target, on
// the operator's own key — roughly one credit, at most four a day per provider once the
// backoff reaches its ceiling. `integrations.md` section 3 records why that is opt-out rather
// than opt-in: a provider that can never recover is a far worse default.

import type { Adapter } from '@proxlane/adapters';
import { HEALTH, type HealthState, probeDelayMs } from '@proxlane/shared';
import type { HealthStore } from './health-store.js';
import type { HttpTransport } from './transport.js';

/**
 * Where a probe points.
 *
 * The same host `pnpm record` and the live canary use, so a probe failure means the provider
 * rather than the target — and so the three code paths that need "a URL that has always
 * worked" agree on which one it is. A probe against an arbitrary customer URL would confuse
 * "the provider is back" with "that one site is reachable again".
 */
export const PROBE_URL = 'https://httpbin.dev/html';

export interface ProberDeps {
	readonly health: HealthStore;
	readonly transport: HttpTransport;
	readonly candidates: ReadonlyArray<{ adapter: Adapter; key: string }>;
	/**
	 * Take an exclusive lease before probing a provider, for `ttlMs`. Returns false if another
	 * replica holds it.
	 *
	 * Omit when state is process-local: there is nobody to race. With Valkey and several
	 * replicas, every one of them sees the same demoted provider and would probe it on the
	 * same schedule — N times the cost, and N conflicting `recordProbe` calls against a
	 * counter that is supposed to mean "consecutive clean probes".
	 */
	readonly lease?: (key: string, ttlMs: number) => Promise<boolean>;
	readonly now?: () => number;
	readonly onError?: (where: string, err: unknown) => void;
}

/** How often the loop wakes. Individual providers are paced by `probeDelayMs`, not by this. */
const TICK_MS = 60_000;

interface Attempted {
	/** When this provider was last probed, so `probeDelayMs` can be honoured. */
	at: number;
	/** How many probes have been sent since it was demoted; drives the backoff. */
	n: number;
}

export class Prober {
	readonly #deps: ProberDeps;
	readonly #now: () => number;
	readonly #onError: (where: string, err: unknown) => void;
	readonly #lastProbe = new Map<string, Attempted>();
	#timer: NodeJS.Timeout | undefined;
	#running = false;

	constructor(deps: ProberDeps) {
		this.#deps = deps;
		this.#now = deps.now ?? (() => Date.now());
		this.#onError =
			deps.onError ??
			((where, err) =>
				process.stderr.write(
					`  probe ${where} failed: ${err instanceof Error ? err.message : String(err)}\n`,
				));
	}

	start(): void {
		if (this.#timer !== undefined) return;
		// `unref` so an idle prober never holds the process open. A gateway that will not exit
		// because a timer is pending turns a container stop into a SIGKILL.
		this.#timer = setInterval(() => void this.tick(), TICK_MS);
		this.#timer.unref();
	}

	stop(): void {
		if (this.#timer !== undefined) clearInterval(this.#timer);
		this.#timer = undefined;
	}

	/**
	 * One pass. Exposed so tests drive it directly rather than waiting on a timer, and so a
	 * future operator command could force one.
	 */
	async tick(): Promise<void> {
		// Never two passes at once. A slow provider must not cause overlapping probes of
		// itself, which would break the consecutive-clean-probe count.
		if (this.#running) return;
		this.#running = true;
		try {
			const ids = this.#deps.candidates.map((c) => c.adapter.capabilities.id);
			let states: ReadonlyMap<string, HealthState>;
			try {
				states = await this.#deps.health.snapshot(ids, this.#now());
			} catch (err) {
				// Fail open, like every other health read: no snapshot means no opinion, so
				// probe nothing rather than probing everything.
				this.#onError('snapshot', err);
				return;
			}
			for (const candidate of this.#deps.candidates) {
				const id = candidate.adapter.capabilities.id;
				if (states.get(id)?.state !== 'demoted') {
					// Recovered or never demoted. Forget the backoff so the next demotion starts
					// at PROBE_FIRST_MS rather than inheriting an old ceiling.
					this.#lastProbe.delete(id);
					continue;
				}
				if (!this.#due(id)) continue;
				await this.#probe(candidate);
			}
		} finally {
			this.#running = false;
		}
	}

	/**
	 * Has this provider's backoff elapsed?
	 *
	 * `n - 1`, not `n`. `probeDelayMs(0)` IS the first delay, so after one probe the wait is
	 * `probeDelayMs(0)` — passing the count directly skipped the first interval and made the
	 * very first retry ten minutes rather than five, doubling every step thereafter.
	 */
	#due(id: string): boolean {
		const last = this.#lastProbe.get(id);
		if (last === undefined) return true;
		return this.#now() - last.at >= probeDelayMs(last.n - 1);
	}

	async #probe(candidate: { adapter: Adapter; key: string }): Promise<void> {
		const id = candidate.adapter.capabilities.id;
		const prev = this.#lastProbe.get(id);
		const attempt = (prev?.n ?? 0) + 1;

		// Claim the provider before spending anything. The lease outlives the attempt by the
		// provider's own max timeout, so a replica that dies mid-probe does not block the
		// others for longer than the request could have taken.
		if (this.#deps.lease !== undefined) {
			let got: boolean;
			try {
				got = await this.#deps.lease(
					`probe:${id}`,
					candidate.adapter.capabilities.maxTimeoutMs + 5_000,
				);
			} catch (err) {
				// Fail CLOSED here, unlike a health read. Losing a lease means we do not know
				// whether another replica is probing, and the cost of guessing wrong is a
				// duplicated spend plus a corrupted consecutive-probe count. Skipping costs one
				// interval.
				this.#onError(`lease ${id}`, err);
				return;
			}
			if (!got) return;
		}

		// Recorded BEFORE the request, so a probe that hangs still paces the next one. Recording
		// after would let a provider that times out be re-probed on every tick.
		this.#lastProbe.set(id, { at: this.#now(), n: attempt });

		let ok = false;
		try {
			const wire = candidate.adapter.translate(
				{
					url: PROBE_URL,
					method: 'GET',
					renderJs: false,
					premium: 'none',
					deadlineMs: candidate.adapter.capabilities.fastTimeoutMs,
				},
				candidate.key,
			);
			const res = await this.#deps.transport.execute(wire, {
				budgetMs: candidate.adapter.capabilities.fastTimeoutMs,
				maxBodyBytes: 1024 * 1024,
			});
			// A probe is clean only on OK. Anything else — a timeout, a provider 5xx, a drift —
			// says the provider is still not answering the way it should, which is the question
			// being asked. A target 404 would be a clean provider, but PROBE_URL does not 404.
			ok = res.kind === 'response' && candidate.adapter.parse(res.response).outcome === 'OK';
		} catch (err) {
			this.#onError(id, err);
			ok = false;
		}

		try {
			this.#deps.health.recordProbe(id, ok, this.#now());
		} catch (err) {
			this.#onError(`record ${id}`, err);
		}
	}

	/** Test and diagnostic access: what the prober believes about pacing. */
	get schedule(): ReadonlyMap<string, Attempted> {
		return this.#lastProbe;
	}
}

export { HEALTH };
