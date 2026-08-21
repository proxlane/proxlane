import { createFileRoute, Link } from '@tanstack/react-router';
import { ResponseAnalyser } from '../components/response-analyser.js';
import { docHead } from '../lib/doc-head.js';

/**
 * The one page on this site that proves a claim instead of making one.
 *
 * The pitch everywhere else is honest block detection. This runs the detector the gateway runs,
 * in the reader's browser, over a response they already have. No account, no key, no request.
 *
 * Named for the query rather than for the feature. Somebody with a 200 full of Cloudflare markup
 * does not search for "response analyser"; they search for what the thing in front of them is.
 */
export const Route = createFileRoute('/block-page-detector')({
	head: () =>
		docHead(
			'Block page detector',
			'Paste a response body and see whether it is a block page, which rule fires, and what proxlane would do with it. Runs in your browser. Nothing is sent anywhere.',
			'/block-page-detector',
		),
	component: Page,
});

function Page() {
	return (
		<div className="mx-auto w-full max-w-[54rem] py-12 sm:py-20">
			<h1 className="font-semibold text-[2rem] text-[color:var(--color-ink)] leading-[1.15] tracking-[-0.02em]">
				Is this a block page?
			</h1>
			<p className="mt-5 max-w-[54ch] text-[color:var(--color-slate)] text-lg leading-relaxed">
				Paste the body your provider returned with its 200. This runs proxlane's own detector
				and tells you which rule fires, if any, and what the gateway would have done next.
			</p>

			<ResponseAnalyser />

			<h2 className="mt-16 font-semibold text-[color:var(--color-ink)] text-xl tracking-[-0.01em]">
				Why the status code is not the question
			</h2>
			<div className="mt-4 flex max-w-[62ch] flex-col gap-4 text-[color:var(--color-slate)] leading-relaxed">
				<p>
					A 403 is easy. Your code already handles it, your provider already counts it as a
					failure, and nobody needs a tool to spot one.
				</p>
				<p>
					The expensive case is the 200. The provider fetched something, called it a success and
					charged you, and what came back was a challenge page. Retry logic sees a 2xx and moves
					on. Whatever you wrote to disk is a captcha with your selectors returning nothing.
				</p>
				<p>
					That is the only case proxlane treats differently, and it is the only case this page
					covers. Everything else the adapter already decided.
				</p>
			</div>

			<h2 className="mt-12 font-semibold text-[color:var(--color-ink)] text-xl tracking-[-0.01em]">
				What the gateway does with it
			</h2>
			<div className="mt-4 flex max-w-[62ch] flex-col gap-4 text-[color:var(--color-slate)] leading-relaxed">
				<p>
					A soft block is not a success. The request moves to the next provider, that provider
					gets a cooldown on the domain so the next caller does not walk into the same wall, and
					hosted billing does not charge for it.
				</p>
				<p>
					The response carries what happened:{' '}
					<span className="font-mono text-[color:var(--color-ink)]">x-outcome</span> names the
					outcome and{' '}
					<span className="font-mono text-[color:var(--color-ink)]">x-detect-rule</span> names
					the rule that fired, so a block in production is a line in your logs rather than a
					mystery in your data.
				</p>
				<p>
					The full list of outcomes lives in{' '}
					<Link
						className="text-[color:var(--color-accent)] underline underline-offset-4"
						to="/docs/outcomes"
					>
						the outcome reference
					</Link>
					, and{' '}
					<Link
						className="text-[color:var(--color-accent)] underline underline-offset-4"
						to="/symptoms/200-captcha-body"
					>
						a 200 with a captcha in it
					</Link>{' '}
					covers the same problem from the debugging side.
				</p>
			</div>

			<h2 className="mt-12 font-semibold text-[color:var(--color-ink)] text-xl tracking-[-0.01em]">
				The rules are thin, and we would rather say so
			</h2>
			<div className="mt-4 flex max-w-[62ch] flex-col gap-4 text-[color:var(--color-slate)] leading-relaxed">
				<p>
					Every rule above is a documented signature: a script path, a cookie name, an asset
					host. None of them has been checked against a block page we captured ourselves, which
					is why each one says so.
				</p>
				<p>
					That corpus is the thing this project needs most and has least of. If this page gets
					your page wrong in either direction, that is worth an issue.
				</p>
			</div>
		</div>
	);
}
