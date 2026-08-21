/**
 * What a request SHAPE does to your bill, per provider.
 *
 * THE QUESTION THIS ANSWERS is the one everybody asks before they sign up and nobody can answer
 * afterwards: I need JavaScript rendering and a residential IP in Germany, so what is that going
 * to cost me? Each vendor documents its own multipliers and none of them documents anybody
 * else's, so the comparison does not exist anywhere. It is four numbers we already ship.
 *
 * IT COMPARES MULTIPLIERS AND REFUSES TO COMPARE BASES, and that distinction is the whole design.
 * Three providers bill in `provider-credits` whose cash value depends on the plan you are on;
 * Bright Data bills in `usd-cents`. Putting those bases on one axis would be the exact mistake
 * the contract's required `unit` field exists to prevent — `contract.ts` says so in as many
 * words, "which is exactly how the first two got mixed".
 *
 * A multiplier is dimensionless. "Turning on rendering multiplies your bill by ten here and by
 * one there" is true regardless of what a credit costs you, it is the number that actually
 * surprises people, and it is comparable. So that is what the page ranks on, and the base is
 * shown beside its unit without ever being ranked.
 *
 * NOTHING HERE KNOWS A PRICE IN MONEY. That is not a limitation to fix later: `plan.md` §7 is
 * still open on the hosted rate, and a page quoting dollars would be inventing a conversion the
 * gateway itself refuses to make. `x-cost-unit` exists on every response for the same reason.
 */

import { CAPABILITIES, costOf } from '@proxlane/adapters';
import type { PremiumTier } from '@proxlane/shared/outcome';

export interface RequestShape {
	readonly renderJs: boolean;
	readonly premium: PremiumTier;
	/** An ISO-3166 alpha-2 code, or `anywhere` when the caller does not care. */
	readonly country: string;
}

export interface ProviderCost {
	readonly id: string;
	/** The provider's line, which is its colour everywhere on this site. */
	readonly line: number;
	/** Can it serve this shape at all? A provider that cannot is not cheap, it is absent. */
	readonly capable: boolean;
	/** Why not, when it cannot. Rendered as-is. */
	readonly reason?: string;
	/**
	 * The dimensionless factor this shape applies to the provider's own base rate.
	 * Comparable across providers. This is what the page ranks on.
	 */
	readonly multiplier: number;
	/** The plainest request this provider sells. Stated, never compared: the units differ. */
	readonly floor: number;
	readonly unit: string;
	readonly effectiveDate: string;
	readonly sourceUrl: string;
}

/**
 * Countries worth offering, chosen because they are where the coverage actually differs.
 *
 * THE LAST THREE EARN THEIR PLACE. The first six are served by everybody, so a picker holding
 * only those shows four identical rows whatever you choose and the "cannot serve" state is dead
 * code nobody ever sees. Turkey, South Africa and Russia are absent from ScrapingBee's classic
 * proxy list, so choosing one is what makes the page demonstrate that providers differ at all.
 *
 * A test asserts this: it looks for a country in here that some provider does not sell, and
 * fails if there is none. That check went red the moment ScrapingBee's list was corrected from
 * seven codes to its real 42, which is exactly when this list stopped being interesting.
 */
export const COUNTRIES = [
	{ code: 'anywhere', label: 'anywhere' },
	{ code: 'us', label: 'United States' },
	{ code: 'gb', label: 'United Kingdom' },
	{ code: 'de', label: 'Germany' },
	{ code: 'br', label: 'Brazil' },
	{ code: 'in', label: 'India' },
	{ code: 'jp', label: 'Japan' },
	{ code: 'tr', label: 'Turkey' },
	{ code: 'za', label: 'South Africa' },
	{ code: 'ru', label: 'Russia' },
] as const;

export const TIERS: readonly PremiumTier[] = ['none', 'residential', 'stealth'];

/**
 * One provider's answer for one shape.
 *
 * Every factor comes off `costTable.multipliers`. A missing entry is 1, not an error: a provider
 * that does not surcharge for something genuinely multiplies by one, which is Bright Data's whole
 * point about rendering.
 */
function costFor(c: (typeof CAPABILITIES)[number], shape: RequestShape): ProviderCost {
	const t = c.costTable;
	const cost = costOf(t, { premium: shape.premium, renderJs: shape.renderJs });
	// The plainest request this provider sells, and the denominator for every factor below. It
	// is what "1x" means, per provider, in that provider's own unit.
	const floor = costOf(t, { premium: 'none', renderJs: false });

	const reasons: string[] = [];
	if (shape.renderJs && !c.renderJs) reasons.push('cannot render JavaScript');
	if (!c.premiumTiers.has(shape.premium)) reasons.push(`has no ${shape.premium} tier`);
	if (cost === null) reasons.push('does not sell that combination');
	if (
		shape.country !== 'anywhere' &&
		c.countryCodes !== 'all' &&
		!c.countryCodes.has(shape.country)
	) {
		reasons.push('does not sell that country');
	}

	return {
		id: c.id,
		line: c.line,
		capable: reasons.length === 0,
		...(reasons.length > 0 ? { reason: reasons.join(', ') } : {}),
		// DERIVED FROM TWO REAL PRICES, which is the whole reason this is worth publishing. It
		// used to be a product of declared multipliers, and Scrapfly's rendering therefore read
		// 5x when their own arithmetic is 1 + 5 = 6. A ratio of two cells cannot get that wrong.
		multiplier: cost === null || floor === null || floor === 0 ? 1 : cost / floor,
		floor: floor ?? 0,
		unit: t.unit,
		effectiveDate: t.effectiveDate,
		sourceUrl: t.sourceUrl,
	};
}

/**
 * Every provider, capable ones first and cheapest-multiplier first within that.
 *
 * Incapable providers stay in the list rather than being filtered out. "Nobody in your country
 * sells a stealth tier" is the most useful thing the page can tell you, and a filtered list says
 * it by showing you nothing, which reads as a bug.
 */
export function compareCost(shape: RequestShape): readonly ProviderCost[] {
	return CAPABILITIES.map((c) => costFor(c, shape)).sort((a, b) => {
		if (a.capable !== b.capable) return a.capable ? -1 : 1;
		if (a.multiplier !== b.multiplier) return a.multiplier - b.multiplier;
		return a.line - b.line;
	});
}

/**
 * True when the shape moves at least one provider's bill.
 *
 * The all-defaults shape multiplies everything by one, and a bar chart of four identical bars
 * labelled "1x" is a chart that has not been asked a question yet.
 */
export function shapeIsInteresting(rows: readonly ProviderCost[]): boolean {
	return rows.some((r) => r.multiplier !== 1);
}

/** `10` -> `10x`, `2.5` -> `2.5x`. Never `1.0x`. */
export function times(n: number): string {
	return `${Number.isInteger(n) ? n : n.toFixed(1)}x`;
}
