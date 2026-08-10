import { z } from 'zod';

// ScrapingBee returns the page as raw bytes, so there is no success envelope to model. What
// IS structured — and what parse() depends on for correctness — is two things:
//
//   1. Their error body, which is JSON, on the path where they never reached the target.
//   2. The `Spb-*` response headers, which carry the target's real status and the real
//      credit cost. parse() cannot tell a target failure from a provider failure without
//      them, so a change in their shape is a contract break, not a curiosity.
//
// A parse failure here is PROVIDER_DRIFT, which pages someone. That is the point: never
// `as`-cast a provider payload, because the cast is exactly the signal, discarded.

/** Observed 2026-08-07: `{"message":"Invalid api key: …"}`. */
export const ScrapingbeeError = z.object({
	message: z.string(),
});
export type ScrapingbeeError = z.infer<typeof ScrapingbeeError>;

/**
 * The headers parse() reads.
 *
 * `spb-initial-status-code` is REQUIRED here and deliberately so — this schema is only
 * applied on the branch where the header was present, and its job is to reject a value that
 * is present but nonsense. Coerced because headers are strings on the wire; bounded to a
 * real HTTP status range because `Number('')` is 0 and `Number('abc')` is NaN, and both
 * would otherwise sail through as "a status".
 */
export const ScrapingbeeMeta = z.object({
	'spb-initial-status-code': z.coerce.number().int().min(100).max(599),
	// Their reported credit cost. Optional: absent on the paths where they never charged,
	// and its absence must not turn a good response into PROVIDER_DRIFT.
	'spb-cost': z.coerce.number().nonnegative().optional(),
	'spb-request-id': z.string().optional(),
	'spb-resolved-url': z.string().optional(),
});
export type ScrapingbeeMeta = z.infer<typeof ScrapingbeeMeta>;
