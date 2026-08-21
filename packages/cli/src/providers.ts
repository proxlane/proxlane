import { CAPABILITIES } from '@proxlane/adapters';
import { EXIT, emit, style } from './output.js';

// `proxlane providers` — what each adapter can actually do, from the registry.
//
// Capabilities are DATA in this codebase: the router filters the failover chain on exactly
// these fields. Printing them from the same source means the CLI cannot advertise a
// capability the router does not believe in.
//
// Reads `CAPABILITIES`, not `REGISTRY`. This used to await all four adapters — their translate
// and parse code, their imports, the lot — to print a table of static objects. `CAPABILITIES` is
// asserted to mirror the registry in both directions, so it is the same data without the load.

export async function providers(json: boolean): Promise<number> {
	if (CAPABILITIES.length === 0) {
		// Non-zero denominator, the same rule the repo applies to its own checks: a listing
		// that found nothing has not proved the registry is empty, only that it looked empty.
		process.stderr.write('no adapters are registered — this build is broken\n');
		return EXIT.FAILED;
	}

	const loaded = [...CAPABILITIES]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((c) => ({
			id: c.id,
			renderJs: c.renderJs,
			countryCodes: c.countryCodes === 'all' ? 'all' : [...c.countryCodes].sort(),
			premiumTiers: [...c.premiumTiers].sort(),
			sessions: c.sessions,
			post: c.post,
			maxTimeoutMs: c.maxTimeoutMs,
			fastTimeoutMs: c.fastTimeoutMs,
			cost: {
				// THE UNIT SHIPS WITH THE NUMBERS. This used to emit `baseMicrocredits` and a set
				// of multipliers with no unit anywhere in the payload, so a script consuming it
				// could compare Bright Data's cents against ScrapingBee's credits and get a
				// confident answer about nothing. `contract.ts` makes `unit` required for exactly
				// that reason; omitting it here undid that one layer up.
				unit: c.costTable.unit,
				// The full matrix: one cost per (tier, rendered), `null` where the provider does
				// not sell that combination. Replaces `baseMicrocredits` plus multipliers, which
				// could not express what any of these providers actually charge.
				matrix: c.costTable.matrix,
				effectiveDate: c.costTable.effectiveDate,
				sourceUrl: c.costTable.sourceUrl,
			},
			keyEnvVar: `${c.id.toUpperCase().replace(/-/g, '_')}_KEY`,
		}));

	emit({ ok: true, command: 'providers', data: loaded }, json, () => {
		const rows = loaded.map((p) => {
			const countries = p.countryCodes === 'all' ? 'all' : `${p.countryCodes.length} listed`;
			return (
				`  ${style(p.id.padEnd(14), 'bold')} renderJs ${String(p.renderJs).padEnd(6)} ` +
				`tiers ${p.premiumTiers.join(',').padEnd(28)} countries ${countries}\n` +
				`  ${' '.repeat(14)} ${style(`budget ${p.maxTimeoutMs}ms last hop / ${p.fastTimeoutMs}ms otherwise · key in $${p.keyEnvVar}`, 'dim')}\n`
			);
		});
		return `\n${rows.join('')}\n  ${style(`${loaded.length} adapter(s). --json for cost tables and full country sets.`, 'dim')}\n\n`;
	});
	return EXIT.OK;
}
