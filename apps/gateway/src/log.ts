// One structured line per `/v1` request, to stdout.
//
// The gateway logged NOTHING before this. Not a line. So the moment it was reachable by anyone
// but its author, these questions had no answer: who is probing it, how many keys were refused,
// which domains were scraped, which provider served them, what the outcome mix looks like,
// whether the terminal retry ever fires. All of it existed only in response headers that the
// caller sees and nobody keeps.
//
// NO LOGGING LIBRARY, deliberately. `pino` is pinned in the toolchain table and would be the
// obvious reach, but it brings eleven transitive dependencies into a process that holds other
// people's provider API keys — for a feature that is `JSON.stringify` and one write. The repo
// already made this trade once, in the other direction, when it refused `@lhci/cli` for putting
// a Chrome downloader on a public repo's dependency graph. Same argument, so the same answer.
//
// NDJSON, because it is the format everything already reads: `docker logs | jq`, Loki, Vector,
// `grep`. A human-pretty format would need a parser written before the first question could be
// asked of it.

/** One request, as it will be written. Field names are short because they repeat forever. */
export interface RequestLine {
	readonly t: string;
	readonly id: string;
	readonly method: string;
	/** The TARGET's host. See `hostOf` for why this is not the URL. */
	readonly host?: string;
	readonly url?: string;
	readonly outcome?: string;
	readonly class?: string;
	readonly status: number;
	readonly provider?: string;
	readonly attempts?: number;
	/** Every attempt as `provider:outcome`, in order. The only field that names who FAILED. */
	readonly chain?: string;
	/**
	 * `account` when the chain ended with nothing but account faults — every hop AUTH_FAILED,
	 * RATE_LIMITED or QUOTA_EXHAUSTED — so the target was never asked. Our credentials or our wallet, and the
	 * greppable signature of a gateway at zero effective capacity (#276). Absent otherwise.
	 */
	readonly legs?: 'account';
	readonly cost?: string;
	readonly detect?: string;
	/** Gateway-internal milliseconds — ours, and the number `k6:soak` gates on. */
	readonly gw?: number;
	/** Provider milliseconds. Their time, not ours. */
	readonly up?: number;
	/**
	 * The simulated outcome, on a sandbox request. Present so a line the sandbox key wrote can
	 * never be read as a provider's behaviour: every other field on it is what the real chain
	 * would have produced, by design, and `legs: account` in particular is a signature people
	 * grep for.
	 */
	readonly sim?: string;
	/**
	 * How many query parameters the gateway did not read: a COUNT, never the names. The log is
	 * where caller-supplied text would be persisted, and a credential pasted as a parameter
	 * name fits the header's naming rule. The response header still names them, to the caller.
	 */
	readonly ignored?: number;
	/**
	 * The ignored names that are almost certainly a typo of ours, with the name we read (#282).
	 * Safe to persist: each is one edit from, or an alias of, a parameter of ours.
	 */
	readonly near_miss?: Readonly<Record<string, string>>;
}

/**
 * The target's host, never its full URL.
 *
 * A scrape URL carries the caller's query string, and query strings carry session tokens, signed
 * URLs and api keys — including OUR OWN: `/v1?api_key=…&url=…` puts the gateway key in the same
 * string. Writing that to a log turns `docker logs` into a credential store, and logs get pasted
 * into issues.
 *
 * The host is what almost every question is actually about: which domains, which of them block,
 * which provider works where. `PROXLANE_LOG_URLS=on` opts into the full URL for someone
 * debugging one target, and says what they are accepting.
 */
export function hostOf(raw: string | undefined): string | undefined {
	if (raw === undefined || raw === '') return undefined;
	try {
		return new URL(raw).host;
	} catch {
		// Unparseable is itself worth seeing — it is what a BAD_REQUEST looks like from here.
		return '(unparseable)';
	}
}

/** `gw;dur=1.2, up;dur=980` — the header the gateway already emits, back into numbers. */
export function timings(header: string | undefined): { gw?: number; up?: number } {
	if (header === undefined) return {};
	const read = (k: string): number | undefined => {
		const m = new RegExp(`${k};dur=([\\d.]+)`).exec(header);
		return m === null ? undefined : Number(m[1]);
	};
	const gw = read('gw');
	const up = read('up');
	return { ...(gw === undefined ? {} : { gw }), ...(up === undefined ? {} : { up }) };
}

export type Sink = (line: string) => void;

/**
 * Off is a real setting, not a level nobody uses.
 *
 * A self-hoster piping into a paid log service should be able to say no. Default on: a gateway
 * that silently records nothing is the state this file exists to end, and making the useful
 * behaviour opt-in reproduces it for everyone who does not read the docs.
 */
export function createLogger(
	env: (k: string) => string | undefined,
	sink: Sink = (l) => process.stdout.write(`${l}\n`),
): ((line: RequestLine) => void) | undefined {
	if ((env('PROXLANE_LOG') ?? 'on') === 'off') return undefined;
	return (line) => {
		try {
			sink(JSON.stringify(line));
		} catch {
			// A log write must never take down the request it describes.
		}
	};
}

/** Outcomes that are a fact about OUR account with the provider, never about the target. */
const ACCOUNT_FAULTS: ReadonlySet<string> = new Set([
	'AUTH_FAILED',
	'RATE_LIMITED',
	'QUOTA_EXHAUSTED',
]);

/**
 * Did this request end with nothing but account faults?
 *
 * `X-Chain` is `provider:OUTCOME>provider:OUTCOME…`. If the request was not served and every
 * hop is an account fault, the target was never asked: the credentials or the wallet ended it,
 * not the site. That is the signature of a gateway at zero effective capacity, and it is the
 * one shape the class header cannot express, because the class is the last hop's view (#275).
 *
 * A served request, a target verdict anywhere in the chain, or no chain at all is `false`.
 */
export function accountOnlyChain(
	chain: string | undefined,
	outcome: string | undefined,
): boolean {
	if (chain === undefined || chain === '' || outcome === 'OK') return false;
	const hops = chain.split('>');
	return hops.every((hop) => {
		const at = hop.lastIndexOf(':');
		return at > 0 && ACCOUNT_FAULTS.has(hop.slice(at + 1));
	});
}
