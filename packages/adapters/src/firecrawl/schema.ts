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
			// Recorded 2026-09-18 on every success: `creditsUsed: 1`, `proxyUsed: "basic"`. Neither
			// is in the API reference's response schema, and both are what makes the cost
			// `reported` rather than our estimate. Optional, so their absence is a cheaper cost
			// figure and not drift.
			creditsUsed: z.number().nonnegative().optional(),
			proxyUsed: z.string().optional(),
		}),
		warning: z.string().nullable().optional(),
	}),
});
export type FirecrawlEnvelope = z.infer<typeof FirecrawlEnvelope>;

/**
 * Their failure body, ON ANY STATUS. Recorded 2026-09-18: a dead host is HTTP 200 with
 * `success: false, code: "SCRAPE_DNS_RESOLUTION_ERROR"`, and every target failure is HTTP 500
 * with `code: "SCRAPE_ALL_ENGINES_FAILED"`. So `success` is read before the status is, and
 * `code` is what parse() branches on. `error` is prose and never read for control flow.
 *
 * All optional: 402 and 429 bodies are `{"error": …}` with no `success` and no `code`, and the
 * STATUS decides those.
 */
export const FirecrawlError = z.object({
	success: z.literal(false).optional(),
	error: z.string().optional(),
	code: z.string().optional(),
});
export type FirecrawlError = z.infer<typeof FirecrawlError>;
