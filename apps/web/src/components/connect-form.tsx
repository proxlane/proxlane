/**
 * Seal provider keys into a tenant token, in the browser. `plan.md` section 2, "Hosted BYOK".
 *
 * NOTHING ON THIS PAGE SENDS A KEY ANYWHERE. The one request it makes is a GET for the gateway's
 * public key; the keys are sealed to it here, by `sealToken`, and only the sealed token is shown.
 * The form never submits, the inputs carry no `name`, and they are cleared once sealed, so a key
 * cannot end up in a URL, a browser's form history or a later paste.
 */

import highlighted from 'virtual:agent-setup';
import { CAPABILITIES } from '@proxlane/adapters';
import { sealToken } from '@proxlane/shared/token';
import { type FormEvent, useState } from 'react';
import { CONNECT, GATEWAY_SLOT, TOKEN_SLOT } from '../lib/agent-setup.js';
import { HOSTED_GATEWAY } from '../lib/hosted.js';
import { Panel } from './artifacts.js';
import { ctaClass } from './cta.js';

const NAMES: Readonly<Record<string, string>> = {
	brightdata: 'Bright Data',
	firecrawl: 'Firecrawl',
	scraperapi: 'ScraperAPI',
	scrapfly: 'Scrapfly',
	scrapingbee: 'ScrapingBee',
};

/** What a key looks like when it is not one string, said beside the field that needs it. */
const SHAPE: Readonly<Record<string, string>> = {
	brightdata: 'Zone name, a colon, then the API token: zone:token',
};

const FIELD =
	'focus-inset w-full rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] px-3.5 py-2.5 font-mono text-[0.875rem] placeholder:font-sans placeholder:text-[color:var(--color-slate)]/70 hover:border-[color:var(--color-slate)]';

const PROVIDERS = CAPABILITIES.map((c) => c.id).sort();

type State =
	| { readonly kind: 'idle' }
	| { readonly kind: 'working' }
	| { readonly kind: 'error'; readonly message: string }
	| { readonly kind: 'done'; readonly token: string; readonly gateway: string };

/** https anywhere, plain http only to this machine: the token is the user's provider keys. */
function gatewayUrl(raw: string): URL | string {
	let u: URL;
	try {
		u = new URL(raw.trim());
	} catch {
		return 'Enter the gateway address, e.g. https://gateway.example.com';
	}
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
	if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
		return 'Use https. The token is your provider keys, and plain http would carry it in the clear';
	}
	return u;
}

async function publicKeyOf(gateway: URL): Promise<string> {
	let res: Response;
	try {
		res = await fetch(new URL('/token-key', gateway), { credentials: 'omit' });
	} catch {
		return Promise.reject(
			new Error(`Could not reach ${gateway.host}. Is it a proxlane gateway?`),
		);
	}
	if (res.status === 501) {
		throw new Error(`${gateway.host} is a proxlane gateway, but it does not accept tokens`);
	}
	const body = (await res.json().catch(() => undefined)) as { publicKey?: unknown } | undefined;
	if (!res.ok || typeof body?.publicKey !== 'string') {
		throw new Error(`${gateway.host} did not answer like a proxlane gateway`);
	}
	return body.publicKey;
}

export function ConnectForm() {
	const [gateway, setGateway] = useState(HOSTED_GATEWAY ?? '');
	const [keys, setKeys] = useState<Record<string, string>>({});
	const [state, setState] = useState<State>({ kind: 'idle' });

	async function seal(e: FormEvent) {
		e.preventDefault();
		const url = gatewayUrl(gateway);
		if (typeof url === 'string') return setState({ kind: 'error', message: url });
		const filled = Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim() !== ''));
		if (Object.keys(filled).length === 0) {
			return setState({ kind: 'error', message: 'Add a key for at least one provider' });
		}
		setState({ kind: 'working' });
		try {
			const token = await sealToken({ keys: filled }, await publicKeyOf(url));
			setKeys({});
			setState({ kind: 'done', token, gateway: url.origin });
		} catch (err) {
			setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
		}
	}

	return (
		<div className="mt-10 flex flex-col gap-8">
			<form onSubmit={seal} autoComplete="off" className="flex flex-col gap-6">
				{HOSTED_GATEWAY === undefined && (
					<label className="flex flex-col gap-2">
						<span className="font-medium text-[color:var(--color-ink)] text-sm">Gateway</span>
						<input
							type="url"
							value={gateway}
							onChange={(e) => setGateway(e.target.value)}
							placeholder="https://gateway.example.com"
							spellCheck={false}
							className={FIELD}
						/>
					</label>
				)}
				{/* A PLAIN FORM, NOT A PANEL. The site draws its diagrams and transcripts in `Panel`s, and a
				    form inside one read as another of those pictures rather than something to type in. */}
				<fieldset className="flex flex-col gap-5">
					<legend className="mb-5 flex flex-col gap-1">
						<span className="font-semibold text-[color:var(--color-ink)] text-lg">
							Your provider keys
						</span>
						<span className="text-[color:var(--color-slate)] text-sm">
							Fill in at least one. Leave the rest empty.
						</span>
					</legend>
					<div className="grid gap-5 sm:grid-cols-2">
						{PROVIDERS.map((id) => (
							<label key={id} className="flex flex-col gap-2">
								<span className="font-medium text-[color:var(--color-ink)] text-sm">
									{NAMES[id] ?? id}
								</span>
								<input
									type="password"
									autoComplete="off"
									spellCheck={false}
									data-1p-ignore
									data-lpignore="true"
									value={keys[id] ?? ''}
									onChange={(e) => setKeys((k) => ({ ...k, [id]: e.target.value }))}
									placeholder={`${NAMES[id] ?? id} API key`}
									className={FIELD}
								/>
								{SHAPE[id] !== undefined && (
									<span className="text-[color:var(--color-slate)] text-xs leading-relaxed">
										{SHAPE[id]}
									</span>
								)}
							</label>
						))}
					</div>
				</fieldset>
				<div className="flex flex-wrap items-center gap-4">
					<button
						type="submit"
						disabled={state.kind === 'working'}
						className={ctaClass('primary', 'md')}
					>
						{state.kind === 'working' ? 'Sealing…' : 'Create token'}
					</button>
					<p aria-live="polite" className="text-sm">
						{state.kind === 'error' && (
							<span className="text-[color:var(--color-accent)]">{state.message}</span>
						)}
					</p>
				</div>
			</form>

			{state.kind === 'done' && <Issued token={state.token} gateway={state.gateway} />}
		</div>
	);
}

function Issued({ token, gateway }: { readonly token: string; readonly gateway: string }) {
	// The build coloured each command with slots in it; the token and gateway exist only here.
	// Escaped although neither can carry markup today: the token is base64url and the gateway an
	// origin, and "today" is not a property the HTML should depend on.
	const fill = (text: string, esc: (v: string) => string) =>
		text.replaceAll(TOKEN_SLOT, esc(token)).replaceAll(GATEWAY_SLOT, esc(gateway));
	const plain = (v: string) => v;
	const claude = fill(CONNECT.claude, plain);
	const curl = fill(CONNECT.curl, plain);
	const claudeHtml = fill(highlighted['connect:claude'] ?? '', escapeHtml);
	const curlHtml = fill(highlighted['connect:curl'] ?? '', escapeHtml);
	return (
		<div className="flex flex-col gap-6">
			<p className="max-w-[62ch] text-[color:var(--color-slate)] leading-relaxed">
				<span className="text-[color:var(--color-ink)]">Your token is your keys, sealed.</span>{' '}
				Anyone holding it can spend them, so keep it where you would keep the keys. It is shown
				once; this page does not keep it.
			</p>
			<Panel label="token" copy={token} what="the token">
				<p className="break-all font-mono text-[0.8125rem]">{token}</p>
			</Panel>
			<Panel label="claude code" copy={claude} what="the Claude Code command">
				<Code html={claudeHtml} />
			</Panel>
			<Panel label="curl" copy={curl} what="the curl command">
				<Code html={curlHtml} />
			</Panel>
			{/* Ours only: another gateway serves `/mcp` just when its operator set PROXLANE_PUBLIC_URL,
			    and this page cannot tell from `/token-key` whether they did. */}
			{gateway === HOSTED_GATEWAY && (
				<Panel label="claude.ai and chatgpt" copy={`${gateway}/mcp`} what="the connector URL">
					<p className="break-all font-mono text-[0.8125rem]">{gateway}/mcp</p>
					<p className="mt-3 text-[color:var(--color-slate)] text-sm leading-relaxed">
						Add it as a custom connector. It signs in by asking for this token, once.
					</p>
				</Panel>
			)}
		</div>
	);
}

function escapeHtml(v: string): string {
	return v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function Code({ html }: { readonly html: string }) {
	return (
		<div
			className="code-hl overflow-x-auto font-mono text-[0.8125rem] leading-[1.9]"
			// Shiki's output from the build, with only the escaped token and gateway put in.
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
