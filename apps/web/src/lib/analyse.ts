/**
 * The response analyser, as a pure function.
 *
 * WHAT THIS IS FOR. Every proxy vendor says it handles blocks. Nobody lets you check. This runs
 * the gateway's own detector over bytes the visitor already has, in their browser, and then reads
 * the consequence out of the same policy table the gateway routes on. No request is made, no
 * target is contacted, no key is involved. It is the one product claim a stranger can verify in
 * five seconds.
 *
 * IT MODELS THE 200 CASE ONLY, and that is the code's own boundary rather than a simplification.
 * `chain.ts` runs `detect` under `outcome === 'OK' && parsed.body !== undefined` — a 403 is the
 * adapter's verdict from `parse`, and re-examining it would turn a 404 that happens to carry a
 * vendor token into a failover. So the honest question this answers is the interesting one:
 * your provider returned 200 and billed you for it, but did you get the page?
 *
 * NO SEPARATE COPY OF THE MAPPING. The outcome comes from `detect`, the consequence from
 * `policyFor`. A tool that reimplemented either would eventually describe a gateway that does
 * not exist, which is worse than having no tool.
 */

// The subpath, never the barrel: `@proxlane/shared` re-exports `id.ts`, which imports
// `node:crypto`, and pulling that into the browser bundle kills hydration site-wide.
// `repo:check` assertion 35 enforces it.
import { detect, SCAN_BYTES } from '@proxlane/detect';
import {
	type CooldownScope,
	type Outcome,
	type OutcomeClass,
	policyFor,
} from '@proxlane/shared/outcome';

/** The content types worth offering. Anything not HTML-ish is passed through untouched. */
export const CONTENT_TYPES = [
	'text/html',
	'text/plain',
	'application/json',
	'application/xml',
] as const;

export interface Analysis {
	readonly outcome: Outcome;
	readonly class: OutcomeClass;
	/** Present only when a rule fired. This is the `X-Detect-Rule` value. */
	readonly ruleId?: string;
	readonly httpStatus: number | 'upstream';
	readonly failover: boolean | 'once';
	readonly cooldown: CooldownScope;
	readonly chargeable: boolean | 'provider-dependent';
	readonly meaning: string;
	/** Bytes the paste encodes to, and how many of them were actually read. */
	readonly bytes: number;
	readonly scanned: number;
	/** True when the paste is longer than the detector's window, so the verdict is partial. */
	readonly truncated: boolean;
	/** False when the content type means the detector never ran. Not the same as "not blocked". */
	readonly ran: boolean;
}

/**
 * Whether `detect` will look at a body of this type at all.
 *
 * Mirrored from the detector's own guard rather than inferred, and pinned by a test that asserts
 * the two agree — a false claim here would say "clean" about a page nothing examined.
 */
export function detectorRuns(contentType: string): boolean {
	return /html|xml|text\/plain/i.test(contentType);
}

/**
 * One paste in, one verdict out.
 *
 * The paste is a string because that is what a clipboard holds, and `detect` takes bytes because
 * `parse` hands over undecoded ones. Encoding as UTF-8 here is the faithful round trip for a body
 * the visitor's own browser already decoded.
 */
export function analyse(text: string, contentType: string): Analysis {
	const body = new TextEncoder().encode(text);
	const ran = detectorRuns(contentType);
	const verdict = ran ? detect(body, contentType, 'utf-8') : { blocked: false as const };
	const outcome: Outcome = verdict.blocked ? 'SOFT_BLOCK' : 'OK';
	const p = policyFor(outcome);
	return {
		outcome,
		class: p.class,
		...('ruleId' in verdict && verdict.ruleId !== undefined ? { ruleId: verdict.ruleId } : {}),
		httpStatus: p.httpStatus,
		failover: p.failover,
		cooldown: p.cooldown,
		chargeable: p.chargeable,
		meaning: p.meaning,
		bytes: body.byteLength,
		scanned: Math.min(body.byteLength, SCAN_BYTES),
		truncated: body.byteLength > SCAN_BYTES,
		ran,
	};
}
