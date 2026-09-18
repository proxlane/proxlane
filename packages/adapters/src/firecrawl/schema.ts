import { z } from 'zod';

// Firecrawl answers every path with JSON. Two shapes matter to parse():
//
//   1. The success envelope, where `data.metadata.statusCode` is the TARGET's status and the
//      page is in `data.rawHtml` (a decoded string) or `data.rawBase64` (the wire bytes).
//   2. Their error body, on the paths where they never reached the target.
//
// A parse failure on the first is PROVIDER_DRIFT. Never `as`-cast: the cast is the signal,
// discarded.

/** `{"success": true, "data": {...}}`. Read from the v2 API reference, 2026-09-18. */
export const FirecrawlEnvelope = z.object({
	success: z.literal(true),
	data: z.object({
		rawHtml: z.string().nullable().optional(),
		rawBase64: z.string().nullable().optional(),
		metadata: z.object({
			// The target's status. Bounded to a real HTTP range for the same reason ScrapingBee's
			// header is: a present-but-nonsense value must be drift, not "a status".
			statusCode: z.number().int().min(100).max(599),
			contentType: z.string().optional(),
			sourceURL: z.string().optional(),
			url: z.string().optional(),
			error: z.string().nullable().optional(),
		}),
		warning: z.string().nullable().optional(),
	}),
});
export type FirecrawlEnvelope = z.infer<typeof FirecrawlEnvelope>;

/**
 * Their error body. `error` is the message; `code` is present on some paths (`UNKNOWN_ERROR`
 * on a 500) and absent on others (402, 429). Both optional, because the STATUS decides the
 * outcome and a reworded message must not turn a clear 402 into drift.
 */
export const FirecrawlError = z.object({
	success: z.literal(false).optional(),
	error: z.string().optional(),
	code: z.string().optional(),
});
export type FirecrawlError = z.infer<typeof FirecrawlError>;
