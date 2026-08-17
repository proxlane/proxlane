import {
	CLASS_ADVICE,
	DOCS_BASE,
	docsUrlFor,
	FAILOVER,
	OUTCOMES,
	type Outcome,
	outcomeClass,
	policyFor,
} from '@proxlane/adapters';
import { EXIT, emit, style } from './output.js';

// `proxlane outcomes` — the whole error taxonomy, as data.
//
// This is the command written specifically for an agent. Every request through proxlane
// resolves to exactly one outcome, and correct handling depends on knowing three
// things per outcome that are NOT guessable from its name: whether it fails over, whether
// you are charged, and what HTTP status the caller sees.
//
// An agent cannot discover that by trial, because most outcomes cannot be provoked on
// demand — the same wall that keeps block and captcha fixtures out of the recorder. So the
// table is published rather than left to be inferred.
//
// It is generated from FAILOVER at runtime, never transcribed, so it cannot drift from the
// behaviour it documents.

export function outcomes(args: string[], json: boolean): number {
	const only = args.find((a) => !a.startsWith('-'))?.toUpperCase();
	if (only !== undefined && !(OUTCOMES as readonly string[]).includes(only)) {
		// Listing the valid set beats "invalid outcome": the caller can retry without a
		// second round trip, which is the whole B9 thesis applied to arguments.
		process.stderr.write(`unknown outcome "${only}". Known: ${OUTCOMES.join(', ')}\n`);
		return EXIT.USAGE;
	}

	const list = (only === undefined ? OUTCOMES : [only as Outcome]) as readonly Outcome[];
	// `action`, `what` and `docs` alongside the policy.
	//
	// The policy fields say what the GATEWAY does; none of them says what the CALLER should do,
	// and for an agent that is the only question. Worse, `failover: true` invites exactly the
	// wrong reading — on a blocked outcome it means proxlane already tried every provider, so a
	// caller who retries buys the same answer twice.
	//
	// Derived from the class, never transcribed, so this cannot drift from the docs page that
	// renders the same strings.
	const data = list.map((o) => ({
		outcome: o,
		...policyFor(o),
		...CLASS_ADVICE[outcomeClass(o)],
		docs: docsUrlFor(o),
	}));

	emit({ ok: true, command: 'outcomes', data }, json, () => {
		const rows = data.map((d) => {
			const failover =
				d.failover === true ? 'always' : d.failover === false ? 'never' : String(d.failover);
			const charged =
				d.chargeable === true ? 'yes' : d.chargeable === false ? 'no' : String(d.chargeable);
			return (
				`  ${style(d.outcome.padEnd(22), 'bold')} ${String(d.httpStatus).padEnd(9)} ` +
				`failover ${failover.padEnd(7)} charged ${charged.padEnd(19)} ` +
				`${d.pages ? style('PAGES', 'yellow') : ''}\n      ${style(d.meaning, 'dim')}\n` +
				// The remedy on its own line, and NOT dimmed: it is the line a reader came for.
				// Everything above says what happened; this says what to do about it.
				`      ${style(`${d.action}.`, 'bold')} ${style(d.what, 'dim')}\n`
			);
		});
		return (
			`\n  ${style('outcome', 'dim').padEnd(24)} ${style('status', 'dim')}\n\n${rows.join('')}\n` +
			`  ${style(`${data.length} outcome(s). Every request resolves to exactly one.`, 'dim')}\n` +
			`  ${style('--json for the machine-readable form, including cooldown scope and a docs link.', 'dim')}\n` +
			// Printed once for a list, and per-outcome in --json. A single outcome gets its own
			// deep link, which is the case where a human is actually going to follow it.
			`  ${style(only === undefined ? `${DOCS_BASE}/docs/outcomes` : docsUrlFor(list[0] as Outcome), 'dim')}\n\n`
		);
	});
	return EXIT.OK;
}

/** Exported so the help text cannot claim a count the taxonomy does not have. */
export const OUTCOME_COUNT = Object.keys(FAILOVER).length;
