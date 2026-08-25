/**
 * The deploy buttons, in each host's own colour.
 *
 * NOT THEIR BUTTON ART. Render's and DigitalOcean's official badges are 153px and 252px wide,
 * one square-cornered and one at a 6px radius, each with its own type. Side by side they read
 * as two widgets pasted onto a page rather than two choices offered by it. And hotlinking them
 * puts a request to render.com and deploytodo.com on every load of a site whose argument is
 * that it does not leak — the same reason `design.md` self-hosts the fonts.
 *
 * So: our pill, our geometry, their mark and their colour. The mark is each host's own icon
 * file, committed rather than fetched, and the colour is read from their own published button
 * art. Recognition survives; the page stays one design.
 *
 * A hairline and a glow, never a fill — `components/cta.tsx` makes that argument about our own
 * accent, and it applies with more force to somebody else's.
 */

/**
 * Render's mark, from `render.com/icon.svg`.
 *
 * `currentColor`, not a hex: the source file hardcodes `#000` with a `prefers-color-scheme`
 * override, which would fight the theme and would be rejected by `tokens:check` besides.
 */
function RenderMark() {
	return (
		<svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true" focusable="false">
			<path
				fill="currentColor"
				d="m17.1491 1.50583c-2.6812-.1262-4.9358 1.81264-5.3205 4.36717-.0152.11854-.0381.23327-.0571.34799-.5979 3.18169-3.38195 5.59091-6.7258 5.59091-1.19206 0-2.31175-.3059-3.28672-.8413-.11807-.065-.25898.0191-.25898.1529v.6846 10.3137h10.2677v-7.7324c0-1.4226 1.1501-2.5775 2.5669-2.5775h2.5669c2.9059 0 5.2443-2.42069 5.13-5.36528-.1028-2.65013-2.2431-4.8146-4.8824-4.94079z"
			/>
		</svg>
	);
}

/**
 * DigitalOcean's mark, from `docs.digitalocean.com/favicon.svg`. Four paths, one 32x32 box.
 *
 * THE VIEWBOX IS PADDED, and that is not a transcription error. Render's icon file insets its
 * artwork by about 1.5 units in a 24 box; DigitalOcean's runs edge to edge in a 32 box. Set at
 * the same `size-4` the two are drawn at the same *box* size and therefore at visibly different
 * *mark* sizes, which reads as one logo being bigger than the other rather than as two logos.
 * 2.4 units of padding on a 32 box matches Render's ratio.
 */
function DigitalOceanMark() {
	return (
		<svg
			viewBox="-2.4 -2.4 36.8 36.8"
			className="size-4 shrink-0"
			aria-hidden="true"
			focusable="false"
		>
			<g fill="currentColor">
				<path d="M16.0219 25.8036V32C26.4874 32 34.6316 21.8881 31.2065 10.902C29.6842 6.11214 25.8785 2.27268 21.0834 0.790112C10.1231-2.63119 0 5.54192 0 15.9959H6.20324C6.20324 9.45741 12.7109 4.36347 19.6372 6.87243C22.187 7.78478 24.2421 9.83756 25.1555 12.3845C27.6672 19.3032 22.6057 25.8036 16.0219 25.8036Z" />
				<path d="M9.85547 25.8417H16.0206V19.6834H9.85547V25.8417Z" />
				<path d="M9.85474 30.5934H5.09766V25.8417L9.85547 25.8417L9.85474 30.5934Z" />
				<path d="M1.10938 25.8417H5.06727V21.8882H1.10938V25.8417Z" />
			</g>
		</svg>
	);
}

/** Everything that differs between the two, in one place, so nothing is typed twice. */
const HOSTS = {
	render: {
		name: 'Render',
		Mark: RenderMark,
		// The `repo` parameter is not decoration: without it Render reads the repository from
		// the `Referer` header, which a privacy-conscious browser will not send.
		href: 'https://render.com/deploy?repo=https://github.com/proxlane/proxlane',
		// `border-`/`text-`/`shadow-` are written out rather than built from a template string,
		// because Tailwind scans source text and a computed class name is never emitted.
		border: 'border-[color:var(--color-brand-render)]',
		text: 'text-[color:var(--color-brand-render)]',
		glow: 'hover:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-brand-render)_18%,transparent),0_8px_28px_-8px_color-mix(in_oklab,var(--color-brand-render)_55%,transparent)]',
		price: 'free',
	},
	digitalocean: {
		name: 'DigitalOcean',
		Mark: DigitalOceanMark,
		href: 'https://cloud.digitalocean.com/apps/new?repo=https://github.com/proxlane/proxlane/tree/main',
		border: 'border-[color:var(--color-brand-digitalocean)]',
		text: 'text-[color:var(--color-brand-digitalocean)]',
		glow: 'hover:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-brand-digitalocean)_18%,transparent),0_8px_28px_-8px_color-mix(in_oklab,var(--color-brand-digitalocean)_55%,transparent)]',
		price: '$5/mo',
	},
} as const;

export type DeployHost = keyof typeof HOSTS;

/** The hosts, in the order they are offered. Free first. */
export const DEPLOY_HOSTS: readonly DeployHost[] = ['render', 'digitalocean'];

/**
 * One deploy button.
 *
 * THE PRICE IS INSIDE THE PILL, not captioned under it. It was a caption first, and in a row
 * that also held two navigation buttons only half the row had one, so the bottom edge was
 * ragged and each caption centred itself under its own pill, lining up with nothing. Inline it
 * sits where the decision is made and the row keeps one baseline.
 *
 * It is never omitted: a button labelled "deploy" that lands on a checkout is the thing this
 * page argues against. The nuance behind each price — Render sleeps, DigitalOcean does not —
 * is a sentence, so it lives in the prose underneath rather than in a button.
 */
export function DeployButton({ host }: { readonly host: DeployHost }) {
	const h = HOSTS[host];
	const { Mark } = h;
	return (
		<a
			href={h.href}
			className={[
				'group inline-flex min-h-12 shrink-0 items-center justify-center gap-2.5 whitespace-nowrap rounded-full border px-5 font-medium text-base',
				'transition-[color,border-color,box-shadow,transform] duration-200 ease-(--ease-lane)',
				'hover:-translate-y-px motion-reduce:transform-none motion-reduce:transition-none',
				h.border,
				h.text,
				h.glow,
			].join(' ')}
		>
			<Mark />
			Deploy on {h.name}
			{/* SMALLER, NOT DIMMER. This was `color-mix(currentColor 60%, transparent)`, which reads
			    as a receding price and measured as a contrast failure: Lighthouse flagged both
			    spans, because DigitalOcean's blue is 4.51:1 at FULL strength and anything below
			    full drops it under 4.5. Size and weight separate the price from the label without
			    touching the colour, which is the one axis here with no headroom. */}
			<span className="font-normal text-sm">{h.price}</span>
		</a>
	);
}

/** Both buttons, one row, one baseline. */
export function DeployRow() {
	return (
		<div className="flex flex-wrap items-center gap-3">
			{DEPLOY_HOSTS.map((host) => (
				<DeployButton key={host} host={host} />
			))}
		</div>
	);
}
