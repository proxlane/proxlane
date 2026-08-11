import { z } from 'zod';

// Scrapfly is the one launch provider that returns a JSON ENVELOPE rather than the page,
// so unlike the other two there is a real success payload to model — and parse()'s
// correctness depends on every field below. A cast here would discard exactly the drift
// signal the taxonomy reserves PROVIDER_DRIFT for.
//
// Shapes observed against the live API 2026-08-07.

/** Their structured failure, e.g. `ERR::SCRAPE::BAD_UPSTREAM_RESPONSE`. */
export const ScrapflyResultError = z.object({
	code: z.string(),
	http_code: z.number().int().optional(),
	message: z.string().optional(),
});

export const ScrapflyResult = z.object({
	/**
	 * The TARGET's status, distinct from the envelope's own HTTP status. A target 404 arrives
	 * as HTTP 200 with this set to 404 — reading the transport status alone would record
	 * every dead target as a success.
	 *
	 * NULLABLE, and this was a real bug before it was a comment. On their network-error path
	 * (`ERR::SCRAPE::NETWORK_ERROR`, seen against a target too slow for them) there is no
	 * target response at all, so the field is null. Requiring a number here made every such
	 * response fail the schema and come back PROVIDER_DRIFT — which PAGES SOMEONE — for what
	 * is an ordinary, well-formed error. Absent-because-there-was-no-response is not drift.
	 */
	status_code: z.number().int().min(100).max(599).nullable(),
	/**
	 * `text` means `content` is an already-decoded UTF-8 string; `binary` means it is base64.
	 * parse() branches on this, so an unexpected value must fail loudly rather than be
	 * guessed at — hence the enum rather than z.string().
	 */
	format: z.enum(['text', 'binary', 'clob', 'blob']),
	content: z.string(),
	content_encoding: z.string().optional(),
	content_type: z.string().optional(),
	/**
	 * The TARGET's response headers, verbatim. Scrapfly is the only launch provider that
	 * exposes them as a structured map rather than prefixed copies. Loose on purpose: header
	 * names and values are the site's, not a contract of ours, so a strict shape here would
	 * turn any unusual header into PROVIDER_DRIFT.
	 */
	response_headers: z.record(z.string(), z.string()).optional(),
	error: ScrapflyResultError.nullish(),
});

/** Reported spend. Authoritative, unlike anything a cost table can estimate. */
export const ScrapflyContext = z.object({
	cost: z.object({ total: z.number().nonnegative() }).optional(),
});

export const ScrapflyEnvelope = z.object({
	result: ScrapflyResult,
	context: ScrapflyContext.optional(),
	uuid: z.string().optional(),
});
export type ScrapflyEnvelope = z.infer<typeof ScrapflyEnvelope>;

/**
 * Their account-level failure, which has NO `result` key at all.
 *
 * That structural difference is the discriminator: `result` present means they reached the
 * target and the outcome is a fact about it; absent means the failure is theirs or the
 * key's. Verified — a bad key returns HTTP 401 with `{error_id, http_code, message, reason}`
 * and no result.
 */
export const ScrapflyAccountError = z.object({
	http_code: z.number().int().optional(),
	message: z.string().optional(),
	code: z.string().optional(),
});
export type ScrapflyAccountError = z.infer<typeof ScrapflyAccountError>;
