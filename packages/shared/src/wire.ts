// The wire shapes: what an adapter's `translate` produces, and what its `parse` consumes.
//
// THESE LIVE IN `shared`, NOT IN `adapters`, and that is a correction rather than a
// preference — the same one CLAUDE.md records for the outcome taxonomy. `adapters` re-exports
// them, so an adapter author still imports everything from `@proxlane/adapters`.
//
// The reason is `transport.ts`, next to this file. Only one thing in the system may perform
// network I/O, and the canary lives inside `packages/adapters` — which cannot import
// `apps/gateway` without inverting the layering. So the executor has to sit at or below
// `adapters`, and these types have to sit with it. Putting both in `adapters` instead would
// hand network I/O to adapter-engineer under CODEOWNERS when it is platform-engineer's by
// the ownership table, which is exactly the mistake the taxonomy move fixed.

export interface ProviderHttpRequest {
	readonly url: string;
	readonly method: 'GET' | 'POST';
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: string;
	/** Per-attempt, derived by the router. The adapter does not choose it. */
	readonly timeoutMs: number;
}

export interface ProviderHttpResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	/**
	 * Wire bytes: after transfer-decoding, before charset decoding.
	 *
	 * undici has already handled `content-encoding`, so `parse` never sees gzip. Charset
	 * decoding has NOT happened — a page declaring Shift_JIS in a `<meta>` tag is still
	 * raw here, which is the only way `/detect` can fingerprint it without mojibake.
	 */
	readonly body: Uint8Array;
}
