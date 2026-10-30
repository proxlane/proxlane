import { createFileRoute, Link } from '@tanstack/react-router';
import { ConnectForm } from '../components/connect-form.js';
import { docHead } from '../lib/doc-head.js';
import { HOSTED_GATEWAY } from '../lib/hosted.js';

/**
 * Turn provider keys into one proxlane token, for a gateway running hosted mode.
 *
 * KEPT OUT OF SEARCH until our own hosted gateway is live (`lib/hosted.ts`). Until then it works
 * for anyone running hosted mode themselves, and an indexed page would promise a service a
 * visitor cannot use without one.
 */
export const Route = createFileRoute('/connect')({
	head: () => {
		const head = docHead(
			'Connect your provider keys',
			'Seal your scraping API keys into one proxlane token, in your browser. The gateway never stores them.',
			'/connect',
		);
		return HOSTED_GATEWAY === undefined
			? { ...head, meta: [...head.meta, { name: 'robots', content: 'noindex' }] }
			: head;
	},
	component: Page,
});

function Page() {
	return (
		<div className="mx-auto w-full max-w-[54rem] py-12 sm:py-20">
			<h1 className="font-semibold text-[2rem] text-[color:var(--color-ink)] leading-[1.15] tracking-[-0.02em]">
				Connect your provider keys
			</h1>
			<p className="mt-5 max-w-[56ch] text-[color:var(--color-slate)] text-lg leading-relaxed">
				Paste the keys for the providers you use. They are sealed into one token here, in your
				browser, and the gateway reads them only while serving your request. Nothing stores
				them.
			</p>

			<ConnectForm />

			<h2 className="mt-16 font-semibold text-[color:var(--color-ink)] text-xl tracking-[-0.01em]">
				What happens to your keys
			</h2>
			<div className="mt-4 flex max-w-[62ch] flex-col gap-4 text-[color:var(--color-slate)] leading-relaxed">
				<p>
					This page fetches the gateway's public key and seals your keys to it. Only that
					gateway can open the token, and it keeps no copy: no account, no database row. The
					token itself is the record.
				</p>
				<p>
					Each request bills your own provider accounts, as it would on your machine. To revoke
					a token, rotate the provider key inside it; the old token then fails like any wrong
					key.
				</p>
				<p>
					Rather run it yourself? The same gateway{' '}
					<Link
						className="text-[color:var(--color-accent)] underline underline-offset-4"
						to="/docs/quickstart"
					>
						self-hosts in one command
					</Link>
					, with your keys in its own environment.
				</p>
			</div>
		</div>
	);
}
