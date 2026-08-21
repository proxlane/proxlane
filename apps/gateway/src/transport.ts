// The single owner of network I/O.
//
// `translate` and `parse` are pure so they can be tested against recorded bytes; that only
// holds if every request in the system goes through here. This is also where the two
// outcomes no adapter can produce come from — PROVIDER_TIMEOUT and RESPONSE_TOO_LARGE —
// because both are properties of the transfer, not of anything a provider said.

import type { ProviderHttpRequest, ProviderHttpResponse } from '@proxlane/adapters';

export type TransportResult =
	| {
			readonly kind: 'response';
			readonly response: ProviderHttpResponse;
			readonly latencyMs: number;
	  }
	/** Our deadline fired. The provider may be fine; we stopped waiting. */
	| { readonly kind: 'timeout'; readonly afterMs: number }
	/** The body passed the cap mid-transfer and we hung up. */
	| { readonly kind: 'too-large'; readonly cap: number }
	/** DNS, TLS, connection reset — nothing was said, so nothing can be parsed. */
	| { readonly kind: 'error'; readonly message: string }
	/**
	 * THE CALLER WENT AWAY. Not a provider fact, and it must never be recorded as one.
	 *
	 * An abort surfaces as `timeout` because the transport discriminates on its own signal, and
	 * that is right for a deadline — but a client hanging up would then be filed as
	 * PROVIDER_TIMEOUT against a provider that was answering perfectly well, cooling it and
	 * feeding the health statistic a failure nobody caused. Distinguishing the two is what makes
	 * honouring the client signal safe rather than a new attribution bug.
	 */
	| { readonly kind: 'client-gone' };

export interface TransportOptions {
	readonly budgetMs: number;
	readonly maxBodyBytes: number;
	/**
	 * The CALLER's signal, when there is one.
	 *
	 * `c.req.raw.signal` existed and was read by nothing, so a client that hung up at 5s left
	 * the chain walking every provider for the full deadline — 120s by default — paying each
	 * hop and discarding the result. The in-flight slot was held for the whole of it, which is
	 * the part that hurts twice: the gateway sheds real traffic at `maxInflight` to protect a
	 * request nobody is waiting for any more.
	 *
	 * Optional because the chain is also driven by the prober and by tests, where there is no
	 * client to hang up.
	 */
	readonly clientSignal?: AbortSignal;
}

/** Injected so the chain can be tested against recorded exchanges with no network. */
export interface HttpTransport {
	execute(req: ProviderHttpRequest, opts: TransportOptions): Promise<TransportResult>;
}

export function createFetchTransport(): HttpTransport {
	return {
		async execute(req, opts) {
			const controller = new AbortController();
			// The caller going away aborts this hop as surely as the deadline does. Registered
			// with `once`, and removed in the `finally` below, so a long-lived signal does not
			// accumulate a listener per attempt.
			const onClientGone = () => controller.abort();
			opts.clientSignal?.addEventListener('abort', onClientGone, { once: true });
			// Cleared in `finally`, NOT chained to the fetch promise. fetch() resolves when
			// HEADERS arrive, so clearing it there leaves the body read unbounded — measured at
			// 12730ms against a 2000ms budget on a trickling target. For a scraping gateway
			// that is the case that matters, because the provider streams the target's response
			// and slowness lands in the body.
			const timer = setTimeout(() => controller.abort(), opts.budgetMs);
			const started = Date.now();
			try {
				const res = await fetch(req.url, {
					method: req.method,
					headers: req.headers,
					...(req.body === undefined ? {} : { body: req.body }),
					signal: controller.signal,
					// undici has already handled content-encoding by the time we read. Charset
					// decoding has NOT happened and must not: /detect fingerprints the page, and
					// decoding here would have it fingerprint our mojibake instead.
					redirect: 'follow',
				});

				const body = await readCapped(res, opts.maxBodyBytes);
				if (body === TOO_LARGE) {
					controller.abort();
					return { kind: 'too-large', cap: opts.maxBodyBytes };
				}

				const headers: Record<string, string> = {};
				res.headers.forEach((v, k) => {
					headers[k] = v;
				});
				return {
					kind: 'response',
					response: { status: res.status, headers, body },
					latencyMs: Date.now() - started,
				};
			} catch (err) {
				// Discriminated on the SIGNAL, never the message. Node reports an abort as "This
				// operation was aborted", so message-matching passes its happy path and then
				// mislabels the first DNS error whose text happens to contain the word.
				if (controller.signal.aborted) {
					// WHOSE abort, checked before the shared controller's. Both funnel through the
					// same signal, and only the caller's is not a provider fact.
					if (opts.clientSignal?.aborted === true) return { kind: 'client-gone' };
					return { kind: 'timeout', afterMs: Date.now() - started };
				}
				return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
			} finally {
				clearTimeout(timer);
				opts.clientSignal?.removeEventListener('abort', onClientGone);
			}
		},
	};
}

const TOO_LARGE = Symbol('too-large');

/**
 * Read the body with a ceiling, streaming rather than buffering blind.
 *
 * `res.arrayBuffer()` accumulates whatever arrives, so a provider streaming an enormous
 * target would balloon memory before anyone could object. Streaming trips the cap at the
 * moment it is passed, which is also the moment we stop paying for the transfer.
 */
async function readCapped(res: Response, max: number): Promise<Uint8Array | typeof TOO_LARGE> {
	if (res.body === null) {
		const buf = new Uint8Array(await res.arrayBuffer());
		return buf.byteLength > max ? TOO_LARGE : buf;
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value === undefined) continue;
			total += value.byteLength;
			if (total > max) return TOO_LARGE;
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out;
}
