// A transport that serves RECORDED provider exchanges instead of making requests.
//
// This is Layer 2 of `integrations.md` section 6: the full request lifecycle — router,
// adapter, failover walk — run against replayed reality. The only thing faked is the
// network boundary, and it is fed by bytes a real provider actually sent.
//
// Two properties matter more than anything else here.
//
// A MISS IS FATAL. If no recording matches, this throws. It must never invent a plausible
// response, because a fabricated exchange makes every test above it decorative — the same
// reason `pnpm record` refuses to hand-write a block fixture. A green suite that replayed
// nothing is worse than a red one.
//
// IT REPLAYS BYTES, NOT STRINGS. The fixture holds base64 of the wire body, so a Shift_JIS
// page arrives at parse() exactly as it arrived from the provider. Decoding here would have
// /detect fingerprint our mojibake instead of the page.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderHttpRequest, ProviderHttpResponse } from '@proxlane/adapters';

/**
 * Structurally identical to the gateway's `HttpTransport`, but not imported from it.
 *
 * `tooling/` is shared test infrastructure and `apps/gateway` is an application; depending
 * upwards would invert the layering for a type alias. TypeScript is structural, so this
 * satisfies the interface anyway — and the gateway's own test asserts that explicitly, so
 * the two cannot drift apart silently.
 */
export type ReplayResult =
	| {
			readonly kind: 'response';
			readonly response: ProviderHttpResponse;
			readonly latencyMs: number;
	  }
	| { readonly kind: 'timeout'; readonly afterMs: number };

interface RecordedExchange {
	kind: 'exchange';
	category: string;
	target: { url: string; renderJs: boolean };
	// `url` is the SANITIZED provider URL — key replaced with REDACTED. Never replayed as a
	// request; read only for its host, which is how a recording is bound to the provider
	// that produced it.
	request: { method: string; url: string };
	response: { status: number; headers: Record<string, string>; bodyBase64: string };
}
interface RecordedDeadline {
	kind: 'deadline';
	category: string;
	target: { url: string; renderJs: boolean };
	timeoutMs: number;
}
type Recording = RecordedExchange | RecordedDeadline;

export interface ReplayEntry {
	readonly adapter: string;
	readonly category: string;
	readonly recording: Recording;
	/**
	 * The provider endpoint this recording came from, e.g. `api.scraperapi.com`.
	 *
	 * Load-bearing, and its absence was a real bug. Matching on the target alone means every
	 * adapter's recording of `httpbin.dev/status/503` is interchangeable — so ScrapingBee's
	 * parse() was handed ScraperAPI's HTML and returned PROVIDER_ERROR. A replay that answers
	 * with a different provider's bytes is testing nothing, confidently.
	 */
	readonly host: string;
}

/** Load every fixture an adapter has recorded. */
export function loadFixtures(repoRoot: string, adapterId: string): ReplayEntry[] {
	const dir = join(repoRoot, 'packages/adapters/src', adapterId, 'fixtures');
	if (!existsSync(dir)) return [];
	const recordings = readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => ({
			category: f.replace(/\.json$/, ''),
			recording: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Recording,
		}));

	// One host per adapter, taken from whichever recording has a request. A deadline
	// recording has none — there was no exchange — so it inherits its sibling's.
	const withRequest = recordings.find((r) => r.recording.kind === 'exchange');
	const host =
		withRequest === undefined
			? ''
			: new URL((withRequest.recording as RecordedExchange).request.url).host;

	return recordings.map((r) => ({ adapter: adapterId, host, ...r }));
}

export class NoRecordingError extends Error {
	constructor(url: string, known: string[]) {
		super(
			`ReplayTransport has no recording for this request.\n` +
				`  request: ${url.slice(0, 120)}\n` +
				`  loaded : ${known.join(', ') || '(none)'}\n` +
				'  Record it rather than relaxing the match — an invented response makes every ' +
				'test above this one decorative.',
		);
		this.name = 'NoRecordingError';
	}
}

export interface ReplayTransport {
	execute(req: ProviderHttpRequest, opts: { budgetMs: number }): Promise<ReplayResult>;
	/** Every request served, in order. Lets a test assert which hops actually happened. */
	readonly served: string[];
}

/**
 * Build a transport over a set of recordings.
 *
 * Matching is on the TARGET, not on the provider URL. The recorded provider URL has the key
 * replaced with REDACTED while a live request carries a real one, so a URL comparison would
 * never match; and each provider spells its request differently, so there is no shared
 * shape to compare. The target and its renderJs flag are what the recording is actually
 * ABOUT, and conformance already proves every adapter puts the target URL in the request.
 */
export function createReplayTransport(entries: readonly ReplayEntry[]): ReplayTransport {
	const served: string[] = [];
	return {
		served,
		async execute(req, _opts) {
			served.push(req.url);
			const askedHost = safeHost(req.url);
			const hit = entries.find((e) => {
				// The PROVIDER first. Two adapters recording the same target produce two
				// interchangeable-looking entries, and serving the wrong one hands a provider's
				// parse() another provider's bytes — which fails in a way that reads like an
				// adapter bug rather than a harness bug.
				if (e.host !== '' && askedHost !== '' && e.host !== askedHost) return false;
				const t = e.recording.target;
				const present = req.url.includes(t.url) || req.url.includes(encodeURIComponent(t.url));
				// renderJs is part of the identity too: replaying a non-rendered recording for a
				// rendered request would silently answer a different question.
				return present && matchesRenderJs(req.url, t.renderJs);
			});
			if (hit === undefined) {
				throw new NoRecordingError(
					req.url,
					entries.map((e) => `${e.adapter}/${e.category}`),
				);
			}
			if (hit.recording.kind === 'deadline') {
				// A deadline recording has no response by construction — that is the point of
				// having recorded it — so it replays as a timeout.
				return { kind: 'timeout', afterMs: hit.recording.timeoutMs };
			}
			const r = hit.recording.response;
			return {
				kind: 'response',
				response: {
					status: r.status,
					headers: r.headers,
					// Base64 in, bytes out. Never a string: the whole fixture format exists so a
					// page's original encoding survives to /detect intact.
					body: new Uint8Array(Buffer.from(r.bodyBase64, 'base64')),
				},
				latencyMs: 0,
			};
		},
	};
}

/**
 * Did this request ask the provider to render?
 *
 * Read off the wire rather than passed in, because the transport only ever sees a translated
 * request. Every launch adapter spells the flag differently, so the check is deliberately
 * loose: it looks for any truthy rendering parameter. A recording is rejected only when the
 * request and the recording disagree.
 */
function safeHost(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return '';
	}
}

function matchesRenderJs(url: string, recordedRenderJs: boolean): boolean {
	const asked = /(?:render_js|render|renderJs)=true/i.test(url);
	return asked === recordedRenderJs;
}
