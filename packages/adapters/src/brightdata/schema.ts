import { z } from 'zod';

// Bright Data Web Unlocker, `format: "json"`.
//
// WHY JSON AND NOT RAW. `format: "raw"` returns the target's body and nothing else, and the
// API answers 200 whatever the target did. Measured against a deliberate 404: `raw` gave a
// 200 and a body, `json` gave `status_code: 404`. Without the target's real status there is
// no TARGET_NOT_FOUND, no upstream status to pass through, and no honest answer to "did this
// work" — which is the entire product.
//
// Shapes observed against the live API 2026-08-16.

/**
 * The envelope. Three fields, and the interesting one is `headers`.
 *
 * `status_code` is the TARGET's status, distinct from the API's own HTTP status, which is
 * 200 for everything except a malformed request.
 */
export const BrightdataResponse = z.object({
	status_code: z.number().int().min(100).max(599),
	/**
	 * The target's response headers, plus Bright Data's own `x-brd-*` diagnostics.
	 *
	 * Values are typed loosely because a header may legitimately repeat and the API folds
	 * those differently per header. Anything `parse` actually reads is narrowed at the point
	 * of use rather than here, so an unexpected shape on a header nobody consults cannot
	 * produce PROVIDER_DRIFT — which pages a human.
	 */
	headers: z.record(z.string(), z.unknown()),
	/**
	 * The target's body, ALREADY CHARSET-DECODED into a JSON string.
	 *
	 * This is the cost of the envelope, and it is worth stating plainly: everywhere else in
	 * this project a body is wire bytes precisely so `/detect` can fingerprint a page before
	 * charset decoding. Bright Data decodes for us and there is no way to ask it not to while
	 * still getting the status code. So this adapter re-encodes as UTF-8 and reports
	 * `charset: 'utf-8'` honestly, rather than claiming a charset it no longer knows.
	 *
	 * Detection still works: its rules match vendor markers, which survive decoding. What is
	 * lost is the ability to detect mojibake, which is a target-quality signal rather than a
	 * blocking one.
	 */
	body: z.string(),
});

export type BrightdataResponse = z.infer<typeof BrightdataResponse>;

/**
 * Bright Data's own failure code, read out of `x-brd-error-code`.
 *
 * THE FINDING THAT SHAPES `parse`. The Unlocker does not pass a target 5xx through: it
 * REJECTS it and answers `status_code: 502` with `x-brd-error-code: http_status` and a
 * message naming the real status. A DNS failure arrives the same way, 502 with a different
 * message.
 *
 * So a bare 502 from this provider means one of three unrelated things — the target erred,
 * the target does not resolve, or Bright Data itself failed — and reading only
 * `status_code` would file all of them as PROVIDER_ERROR. That would blame the provider for
 * a dead target, cool it down for a domain that is simply gone, and fail over three times to
 * re-discover the same thing.
 */
/**
 * The TARGET's HTTP status, in raw mode.
 *
 * This header is why the adapter can ask for `format: 'raw'` at all. The original code chose
 * `json` because "raw returns the body and an API 200 whatever the target did, so a 404 is
 * indistinguishable from a success" — true of the API's own status line, and false of the
 * response as a whole. Bright Data reports the target's status here on every raw response:
 * measured 404, 503 and 200 correctly on 2026-08-19.
 */
export const BRD_STATUS_HEADER = 'x-brd-status-code';
export const BRD_ERROR_HEADER = 'x-brd-error-code';
export const BRD_MESSAGE_HEADER = 'x-brd-error';

/** `response status was rejected: 500 status code` -> 500. */
export function targetStatusFromMessage(message: string): number | undefined {
	const m = /\b(\d{3})\s+status code\b/.exec(message);
	if (m?.[1] === undefined) return undefined;
	const n = Number(m[1]);
	return n >= 100 && n <= 599 ? n : undefined;
}
