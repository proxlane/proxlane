import { z } from 'zod';

// The service answers a successful read as text/plain, so there is no JSON envelope to
// model on the happy path. This schema describes its ERROR envelope, which is the only
// JSON it emits — parse() checks the status before reaching for it.
//
// Observed shape, 2026-08-07, from a request naming an unresolvable host:
//
//   {"data":null,"path":"url","code":422,"name":"SubmittedDataMalformedError",
//    "status":42203,"message":"Domain '…' could not be resolved…"}
//
// A parse failure here is PROVIDER_DRIFT and pages someone. That is the point: it means
// their API changed under us, and the alternative — an `as` cast — discards the signal.

export const JinaReaderError = z.object({
	code: z.number(),
	name: z.string(),
	message: z.string(),
	// `status` is their internal sub-code (42203), not an HTTP status. Optional because it
	// is not documented and must not be the thing that fails the parse.
	status: z.number().optional(),
	path: z.string().nullable().optional(),
	data: z.unknown().nullable().optional(),
});

export type JinaReaderError = z.infer<typeof JinaReaderError>;
