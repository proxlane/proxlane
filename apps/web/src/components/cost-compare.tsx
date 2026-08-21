/**
 * What your request shape does to your bill, per provider.
 *
 * THE TOOL THE DETECTOR SHOULD HAVE BEEN. A block-page checker needs you to already have a block
 * page, at which point you have looked at the HTML and know. This needs three clicks and answers
 * a question you cannot answer anywhere else, because each vendor documents its own multipliers
 * and nobody documents the comparison.
 *
 * BARS ARE LINEAR AND THAT IS DELIBERATE. A log scale would make a 1x and a 375x look like
 * neighbours, which is a chart arguing against its own point. Linear, with a floor so the small
 * bars stay visible, and the number printed on every row so the bar never has to be measured.
 *
 * THE COLOURS ARE THE PROVIDERS' OWN LINES. This is the one place a line colour is not just
 * allowed but required: `--color-line-N` identifies a provider everywhere on this site, and a
 * cost chart of providers is exactly what it is for.
 */

import type { PremiumTier } from '@proxlane/shared/outcome';
import { useMemo, useState } from 'react';
import {
	COUNTRIES,
	compareCost,
	type ProviderCost,
	shapeIsInteresting,
	TIERS,
	times,
} from '../lib/cost.js';
import { Panel } from './artifacts.js';

const TIER_LABEL: Record<PremiumTier, string> = {
	none: 'datacenter',
	residential: 'residential',
	stealth: 'stealth',
};

/**
 * A cost in the unit a human reads it in.
 *
 * Everything is stored in microcredits — 1 credit = 1,000,000 — because money must not be a
 * float. "base 1,000,000 micro-credits" is correct and unreadable, and worse, it invites exactly
 * the mistake that shipped: Bright Data's base was a hundred times too low because somebody
 * computed micro-dollars against a field denominated in cents. Showing the real quantity is how
 * that gets noticed.
 */
const UNIT_LABEL: Partial<Record<string, string>> = {
	'provider-credits': 'credit',
	'usd-cents': 'US cents',
};

function naturalUnit(micro: number, unit: string): string {
	const n = micro / 1_000_000;
	const label = UNIT_LABEL[unit] ?? unit;
	const shown = Number.isInteger(n) ? String(n) : n.toPrecision(2).replace(/0+$/, '');
	return `${shown} ${label}${label === 'credit' && n !== 1 ? 's' : ''}`;
}

export function CostCompare() {
	const [renderJs, setRenderJs] = useState(false);
	const [premium, setPremium] = useState<PremiumTier>('none');
	const [country, setCountry] = useState<string>('anywhere');

	const rows = useMemo(
		() => compareCost({ renderJs, premium, country }),
		[renderJs, premium, country],
	);
	const factors = rows.filter((r) => r.capable).map((r) => r.multiplier);
	const max = Math.max(...factors, 1);
	// The SPREAD, not the maximum. The copy used to read "75x apart at the extremes" off `max`
	// alone, while the cheapest capable provider was at 6x — so the real gap was 12.5x and the
	// page overstated its own case by six times. On a page about other people's arithmetic.
	const spread = factors.length > 1 ? max / Math.min(...factors) : 1;
	const interesting = shapeIsInteresting(rows);

	return (
		<div className="mt-10 flex flex-col gap-6">
			<Panel label="your request" bodyClass="p-0">
				<div className="flex flex-col divide-y divide-[color:var(--color-rule)]">
					<Row label="JavaScript rendering">
						<Toggle on={renderJs} onChange={setRenderJs} label="JavaScript rendering" />
					</Row>
					<Row label="proxy type">
						<Segmented
							options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
							value={premium}
							onChange={(v) => setPremium(v as PremiumTier)}
						/>
					</Row>
					<Row label="from">
						<select
							aria-label="Country"
							value={country}
							onChange={(e) => setCountry(e.target.value)}
							className="focus-inset rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-ground)] px-2.5 py-1.5 font-mono text-[color:var(--color-ink)] text-xs"
						>
							{COUNTRIES.map((c) => (
								<option key={c.code} value={c.code}>
									{c.label}
								</option>
							))}
						</select>
					</Row>
				</div>
			</Panel>

			<Panel label="what it multiplies your bill by" bodyClass="p-0">
				<ul className="divide-y divide-[color:var(--color-rule)]">
					{rows.map((r) => (
						<Bar key={r.id} row={r} max={max} />
					))}
				</ul>
			</Panel>

			<p className="max-w-[62ch] text-[color:var(--color-slate)] leading-relaxed">
				{interesting ? (
					<>
						Same request, {times(spread)} between the cheapest and the dearest that will serve
						it. Which is the argument for routing across providers rather than picking one and
						hoping.
					</>
				) : (
					<>
						A plain request costs everyone their base rate. Turn on rendering or ask for a
						residential IP and the four stop agreeing.
					</>
				)}
			</p>

			<Sources rows={rows} />
		</div>
	);
}

function Row({
	label,
	children,
}: {
	readonly label: string;
	readonly children: React.ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
			<span className="font-mono text-[color:var(--color-slate)] text-xs">{label}</span>
			{children}
		</div>
	);
}

/**
 * One provider's answer.
 *
 * The bar is a `<span>` sized by an inline width, because the value is continuous and a class
 * per percentage is not a thing. The colour is the provider's line, likewise inline: Tailwind
 * cannot build `--color-line-${n}` at compile time and a lookup table of four classes would be
 * the same data written twice.
 */
function Bar({ row, max }: { readonly row: ProviderCost; readonly max: number }) {
	// A floor, so a 1x against a 375x is still a mark rather than nothing. Never zero-width: an
	// invisible bar reads as missing data, and missing data is what the `incapable` state means.
	const pct = row.capable ? Math.max(2, (row.multiplier / max) * 100) : 0;
	return (
		<li className="px-4 py-3.5">
			<div className="flex items-baseline justify-between gap-4">
				<span
					className={`font-mono text-sm ${row.capable ? 'text-[color:var(--color-ink)]' : 'text-[color:var(--color-slate)]'}`}
				>
					{row.id}
				</span>
				<span
					className={`shrink-0 font-mono text-sm ${row.capable ? 'text-[color:var(--color-ink)]' : 'text-[color:var(--color-slate)]'}`}
				>
					{row.capable ? times(row.multiplier) : 'cannot'}
				</span>
			</div>
			<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-rule)]">
				{row.capable && (
					<span
						className="block h-full rounded-full transition-[width] duration-500 ease-(--ease-lane) motion-reduce:transition-none"
						style={{ width: `${pct}%`, backgroundColor: `var(--color-line-${row.line})` }}
					/>
				)}
			</div>
			{row.reason !== undefined && (
				<p className="mt-2 text-[color:var(--color-slate)] text-xs">{row.reason}</p>
			)}
		</li>
	);
}

/**
 * Where every number came from, and when.
 *
 * NOT OPTIONAL, and not a footnote either. A pricing comparison with no dates is a page that was
 * true once. Each row links the vendor's own doc so a reader who thinks we are wrong can settle
 * it in one click, and `effectiveDate` is the day we last read it rather than the day we
 * published — those are different facts and only one of them is useful.
 */
function Sources({ rows }: { readonly rows: readonly ProviderCost[] }) {
	return (
		<Panel label="where these came from" bodyClass="p-0">
			<ul className="divide-y divide-[color:var(--color-rule)] text-[0.8125rem]">
				{[...rows]
					.sort((a, b) => a.line - b.line)
					.map((r) => (
						<li key={r.id} className="px-4 py-3">
							<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
								<span className="font-mono">{r.id}</span>
								<span className="font-mono text-[color:var(--color-slate)] text-xs">
									base {naturalUnit(r.floor, r.unit)} · read {r.effectiveDate}
								</span>
							</div>
							<a
								href={r.sourceUrl}
								className="mt-1 block break-all text-[color:var(--color-accent)] text-xs underline underline-offset-4"
							>
								{r.sourceUrl}
							</a>
						</li>
					))}
			</ul>
		</Panel>
	);
}

/** A switch that says what it is, because a bare toggle is a puzzle. */
function Toggle({
	on,
	onChange,
	label,
}: {
	readonly on: boolean;
	readonly onChange: (v: boolean) => void;
	readonly label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={label}
			onClick={() => onChange(!on)}
			className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-200 ease-(--ease-lane) ${
				on
					? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/18'
					: 'border-[color:var(--color-rule)] bg-transparent'
			}`}
		>
			<span
				className={`ml-0.5 block size-5 rounded-full transition-transform duration-200 ease-(--ease-lane) motion-reduce:transition-none ${
					on
						? 'translate-x-5 bg-[color:var(--color-accent)]'
						: 'translate-x-0 bg-[color:var(--color-slate)]'
				}`}
			/>
		</button>
	);
}

/** Three mutually exclusive options, as one control rather than three buttons. */
function Segmented({
	options,
	value,
	onChange,
}: {
	readonly options: readonly { readonly value: string; readonly label: string }[];
	readonly value: string;
	readonly onChange: (v: string) => void;
}) {
	return (
		<div className="flex overflow-hidden rounded-full border border-[color:var(--color-rule)]">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					aria-pressed={o.value === value}
					onClick={() => onChange(o.value)}
					className={`px-3 py-1.5 font-mono text-xs transition-colors duration-200 ${
						o.value === value
							? 'bg-[color:var(--color-accent)]/14 text-[color:var(--color-accent)]'
							: 'text-[color:var(--color-slate)] hover:text-[color:var(--color-ink)]'
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}
