import { type Adapter, REGISTRY } from '@proxlane/adapters';
import { EXIT, emit, style } from './output.js';

// `proxlane providers` — what each adapter can actually do, from the registry.
//
// Capabilities are DATA in this codebase: the router filters the failover chain on exactly
// these fields. Printing them from the same source means the CLI cannot advertise a
// capability the router does not believe in.

export async function providers(json: boolean): Promise<number> {
	const ids = Object.keys(REGISTRY).sort();
	if (ids.length === 0) {
		// Non-zero denominator, the same rule the repo applies to its own checks: a listing
		// that found nothing has not proved the registry is empty, only that it looked empty.
		process.stderr.write('no adapters are registered — this build is broken\n');
		return EXIT.FAILED;
	}

	const loaded = await Promise.all(
		ids.map(async (id) => {
			const adapter: Adapter = await (REGISTRY[id] as () => Promise<Adapter>)();
			const c = adapter.capabilities;
			return {
				id: c.id,
				renderJs: c.renderJs,
				countryCodes: c.countryCodes === 'all' ? 'all' : [...c.countryCodes].sort(),
				premiumTiers: [...c.premiumTiers].sort(),
				sessions: c.sessions,
				post: c.post,
				maxTimeoutMs: c.maxTimeoutMs,
				fastTimeoutMs: c.fastTimeoutMs,
				cost: {
					baseMicrocredits: c.costTable.base,
					effectiveDate: c.costTable.effectiveDate,
					sourceUrl: c.costTable.sourceUrl,
					multipliers: c.costTable.multipliers,
				},
				keyEnvVar: `${c.id.toUpperCase().replace(/-/g, '_')}_KEY`,
			};
		}),
	);

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
