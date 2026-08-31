import { createFileRoute, Link } from '@tanstack/react-router';
import { CostCompare } from '../components/cost-compare.js';
import { docHead } from '../lib/doc-head.js';

/**
 * The comparison page, built around a tool rather than a table.
 *
 * EVERY "BEST SCRAPING API" PAGE ON THE INTERNET is an affiliate table with a winner decided
 * before the research started. This one cannot be: the numbers come out of the capability
 * registry the router filters on, so the page and the product agree by construction, and
 * `CLAUDE.md`'s house rule is that affiliate rate is never an input to routing or rankings.
 *
 * WHAT MAKES IT WORTH READING is the multiplier spread. Each vendor documents its own surcharges
 * and none of them documents anybody else's, so nobody publishes the comparison — and the
 * surcharges are where a scraping bill actually goes. Turning on rendering is free at one
 * provider and ten times the price at another.
 */
export const Route = createFileRoute('/scraping-api-comparison')({
	head: () =>
		docHead(
			'Scraping API comparison',
			'What ScraperAPI, ScrapingBee, Scrapfly and Bright Data charge for the same request. Pick your request shape and see the multiplier each one applies, from their own published rates.',
			'/scraping-api-comparison',
		),
	component: Page,
});

function Page() {
	return (
		<div className="mx-auto w-full max-w-[54rem] py-12 sm:py-20">
			<h1 className="font-semibold text-[2rem] text-[color:var(--color-ink)] leading-[1.15] tracking-[-0.02em]">
				What the same request costs at four providers
			</h1>
			<p className="mt-5 max-w-[56ch] text-[color:var(--color-slate)] text-lg leading-relaxed">
				Not a ranking. The base rate is whatever your plan says it is, and only you know that.
				What nobody publishes is the part that actually moves your bill: what each provider
				charges on top when you ask for rendering, a residential IP, or a specific country.
			</p>

			<CostCompare />

			<h2 className="mt-16 font-semibold text-[color:var(--color-ink)] text-xl tracking-[-0.01em]">
				Why this is a multiplier and not a price
			</h2>
			<div className="mt-4 flex max-w-[62ch] flex-col gap-4 text-[color:var(--color-slate)] leading-relaxed">
				<p>
					Three of these bill in credits. What a credit costs you depends on the plan you are
					on, so the same 5 credits is a different amount of money for two people reading this
					page. The fourth bills in cents per request and issues no credits at all.
				</p>
				<p>
					Putting those on one axis would produce a confident chart of nothing. So the
					comparison is the multiplier, which is dimensionless and therefore actually
					comparable, and each provider's base rate is printed beside its own unit without being
					ranked against anybody.
				</p>
				<p>
					The gateway makes the same distinction for the same reason. Every response carries{' '}
					<span className="font-mono text-[color:var(--color-ink)]">x-cost-estimate</span>{' '}
					alongside <span className="font-mono text-[color:var(--color-ink)]">x-cost-unit</span>
					, rather than converting to a currency it would have to guess at.
				</p>
				{/* THE LIMIT OF THIS PAGE, STATED ON IT. Two of the four price partly on what the
				    target's defences do — ScraperAPI adds ten credits per request when it bypasses
				    Cloudflare, DataDome or PerimeterX, and Scrapfly's ASP may upgrade the proxy pool
				    mid-request. Neither is a function of the request shape, which is the only thing
				    a tier-by-rendering matrix can be keyed on. Saying so here is cheaper than being
				    told, and it is the argument for the reported figure over the estimated one. */}
				<p>
					One thing the multiplier cannot show. Two of these price partly on what the{' '}
					<em>target</em> does, not on what you asked for: ScraperAPI adds ten credits per
					request when it bypasses Cloudflare, DataDome or PerimeterX, and Scrapfly&rsquo;s
					anti-bot mode may upgrade the proxy pool mid-request. Neither depends on the request
					shape, so no table keyed on tier and rendering can hold it. Both providers report what
					they actually charged, which is why the gateway prefers{' '}
					<span className="font-mono text-[color:var(--color-ink)]">reported</span> over{' '}
					<span className="font-mono text-[color:var(--color-ink)]">estimated</span> and tells
					you which one you got.
				</p>
			</div>

			<h2 className="mt-12 font-semibold text-[color:var(--color-ink)] text-xl tracking-[-0.01em]">
				What we do with it
			</h2>
			<div className="mt-4 flex max-w-[62ch] flex-col gap-4 text-[color:var(--color-slate)] leading-relaxed">
				<p>
					Proxlane puts one endpoint in front of all of them. It filters the chain to providers
					that can actually serve your request, tries them in order, and moves on when one
					blocks, errors or times out.
				</p>
				<p>
					Affiliate rate is never an input to that order, and never an input to anything on this
					page. It is a house rule in the repository, which is public, so you can check that
					rather than take our word for it.
				</p>
				<p>
					<Link
						className="text-[color:var(--color-accent)] underline underline-offset-4"
						to="/docs/failover"
					>
						How failover works
					</Link>{' '}
					covers the ordering, and{' '}
					<Link
						className="text-[color:var(--color-accent)] underline underline-offset-4"
						to="/docs/adapters"
					>
						bring your own provider
					</Link>{' '}
					covers adding one that is not on this list.
				</p>
			</div>
		</div>
	);
}
