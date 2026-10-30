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
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { CONNECT, GATEWAY_SLOT, TOKEN_SLOT } from '../lib/agent-setup.js';
import { HOSTED_GATEWAY } from '../lib/hosted.js';
import { CopyButton, Panel } from './artifacts.js';
import { ctaClass } from './cta.js';

const NAMES: Readonly<Record<string, string>> = {
	brightdata: 'Bright Data',
	firecrawl: 'Firecrawl',
	scraperapi: 'ScraperAPI',
	scrapfly: 'Scrapfly',
	scrapingbee: 'ScrapingBee',
};

/**
 * What a key looks like when it is not one string, said under the field, and the check that the
 * pasted value has that shape. Caught here rather than as a 401 from the provider on first use.
 */
const SHAPE: Readonly<
	Record<string, { readonly hint: string; readonly ok: (v: string) => boolean }>
> = {
	brightdata: {
		hint: 'Needs the Web Unlocker zone name, a colon, then the API token.',
		ok: (v) => /^[^:\s]+:\S+$/.test(v),
	},
};

const FIELD =
	'focus-inset w-full rounded-card border bg-[color:var(--color-ground)] py-2.5 pr-11 pl-3.5 font-mono text-[0.875rem] caret-[color:var(--color-accent)] transition-colors placeholder:font-sans placeholder:text-[color:var(--color-slate)]/70 ';
const FIELD_OK = 'border-[color:var(--color-rule)] hover:border-[color:var(--color-slate)]';
const FIELD_BAD = 'border-[color:var(--color-accent)]';

/**
 * Each provider in its own LINE COLOUR, the one it has on every diagram on the site
 * (`capabilities.line`). The form is the map's legend: the keys you fill are the lines the
 * gateway can route over, so a filled field draws its line solid and an empty one stays a ghost.
 */
const PROVIDERS = [...CAPABILITIES]
	.sort((a, b) => a.id.localeCompare(b.id))
	.map((c) => ({ id: c.id, name: NAMES[c.id] ?? c.id, line: `var(--color-line-${c.line})` }));

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

	const filled = PROVIDERS.filter((p) => (keys[p.id] ?? '').trim() !== '');
	const malformed = filled.filter((p) => SHAPE[p.id]?.ok((keys[p.id] ?? '').trim()) === false);

	async function seal(e: FormEvent) {
		e.preventDefault();
		const url = gatewayUrl(gateway);
		if (typeof url === 'string') return setState({ kind: 'error', message: url });
		if (filled.length === 0) {
			return setState({ kind: 'error', message: 'Add a key for at least one provider' });
		}
		if (malformed.length > 0) {
			return setState({
				kind: 'error',
				message: `Check the ${malformed.map((p) => p.name).join(' and ')} key`,
			});
		}
		setState({ kind: 'working' });
		try {
			const sealed = Object.fromEntries(filled.map((p) => [p.id, (keys[p.id] ?? '').trim()]));
			const token = await sealToken({ keys: sealed }, await publicKeyOf(url));
			setKeys({});
			setState({ kind: 'done', token, gateway: url.origin });
		} catch (err) {
			setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
		}
	}

	if (state.kind === 'done') {
		return (
			<Issued
				token={state.token}
				gateway={state.gateway}
				onReset={() => setState({ kind: 'idle' })}
			/>
		);
	}

	return (
		// ONE CARD: the fields and the action that seals them belong to one object, and the footer
		// is where the result of what you typed (the lanes) meets the button that acts on it. A
		// plain card, not a `Panel`: those carry a mono label bar and read as the site's diagrams.
		<form
			onSubmit={seal}
			autoComplete="off"
			noValidate
			className="mt-10 overflow-hidden rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] shadow-panel"
		>
			<div className="flex flex-col gap-7 p-5 sm:p-8">
				{HOSTED_GATEWAY === undefined && (
					<label className="flex max-w-[28rem] flex-col gap-2">
						<span className="font-medium text-[color:var(--color-ink)] text-sm">Gateway</span>
						<input
							type="url"
							value={gateway}
							onChange={(e) => setGateway(e.target.value)}
							placeholder="https://gateway.example.com"
							spellCheck={false}
							className={`${FIELD} ${FIELD_OK}`}
						/>
					</label>
				)}
				<fieldset className="flex flex-col gap-6">
					{/* The page's h1 already names this; a visible legend said it a second time. */}
					<legend className="sr-only">Provider keys</legend>
					<p className="text-[color:var(--color-slate)] text-sm leading-relaxed">
						Fill in the ones you have. With two or more, a blocked request fails over to the
						next.
					</p>
					<div className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
						{PROVIDERS.map((p) => (
							<KeyField
								key={p.id}
								provider={p}
								value={keys[p.id] ?? ''}
								invalid={malformed.includes(p)}
								onChange={(v) => setKeys((k) => ({ ...k, [p.id]: v }))}
							/>
						))}
					</div>
				</fieldset>
			</div>

			<div className="flex flex-col gap-4 border-[color:var(--color-rule)] border-t bg-[color:var(--color-ground)]/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5">
				<div aria-live="polite" className="min-w-0 text-sm">
					{state.kind === 'error' ? (
						<p className="text-[color:var(--color-accent)]">{state.message}</p>
					) : (
						<Route lines={filled} />
					)}
				</div>
				<button
					type="submit"
					disabled={state.kind === 'working' || filled.length === 0}
					className={`${ctaClass('primary', 'md')} disabled:cursor-not-allowed disabled:opacity-45`}
				>
					{state.kind === 'working'
						? 'Sealing…'
						: filled.length === 0
							? 'Create token'
							: `Seal ${filled.length} ${filled.length === 1 ? 'key' : 'keys'} into a token`}
				</button>
			</div>
		</form>
	);
}

type Provider = (typeof PROVIDERS)[number];

function KeyField({
	provider,
	value,
	invalid,
	onChange,
}: {
	readonly provider: Provider;
	readonly value: string;
	readonly invalid: boolean;
	readonly onChange: (v: string) => void;
}) {
	const [shown, setShown] = useState(false);
	const id = useId();
	const on = value.trim() !== '';
	const shape = SHAPE[provider.id];
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between gap-3">
				<label htmlFor={id} className="flex items-center gap-2.5 font-medium text-sm">
					{/* The provider's line: a ghost until the field holds a key, then drawn. */}
					<svg
						width="28"
						height="12"
						viewBox="0 0 22 10"
						aria-hidden="true"
						className="shrink-0 self-center"
					>
						<path
							d="M2 5 H20"
							stroke={provider.line}
							strokeWidth="3"
							strokeLinecap="round"
							strokeDasharray={on ? undefined : '0.1 5'}
						/>
						{on && (
							<circle
								cx="11"
								cy="5"
								r="3.25"
								fill="var(--color-surface)"
								stroke={provider.line}
								strokeWidth="2"
							/>
						)}
					</svg>
					<span className="text-[color:var(--color-ink)]">{provider.name}</span>
				</label>
				{/* The format, on the label row so a field with a rule is no taller than one without. */}
				{shape !== undefined && (
					<span className="font-mono text-[color:var(--color-slate)] text-xs">zone:token</span>
				)}
			</div>
			<div className="relative">
				<input
					id={id}
					type={shown ? 'text' : 'password'}
					autoComplete="off"
					spellCheck={false}
					data-1p-ignore
					data-lpignore="true"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="Paste API key"
					aria-invalid={invalid || undefined}
					aria-describedby={invalid ? `${id}-hint` : undefined}
					className={`${FIELD} ${invalid ? FIELD_BAD : FIELD_OK}`}
				/>
				<button
					type="button"
					onClick={() => setShown((s) => !s)}
					aria-label={shown ? `Hide the ${provider.name} key` : `Show the ${provider.name} key`}
					aria-pressed={shown}
					className="focus-inset absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-card text-[color:var(--color-slate)] hover:text-[color:var(--color-ink)]"
				>
					<Eye open={shown} />
				</button>
			</div>
			{invalid && shape !== undefined && (
				<span
					id={`${id}-hint`}
					className="text-[color:var(--color-accent)] text-xs leading-relaxed"
				>
					{shape.hint}
				</span>
			)}
		</div>
	);
}

function Eye({ open }: { readonly open: boolean }) {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
			<circle cx="8" cy="8" r="2" />
			{open && <path d="M2.5 13.5 13.5 2.5" />}
		</svg>
	);
}

/**
 * The route the token will carry: one line per key, merging into the station that is the token.
 * Empty, it says what is missing in words rather than drawing an empty map.
 */
function Route({ lines }: { readonly lines: readonly Provider[] }) {
	if (lines.length === 0) {
		return <p className="text-[color:var(--color-slate)]">No keys yet.</p>;
	}
	return (
		<p className="flex items-center gap-3 text-[color:var(--color-slate)]">
			<span className="flex -space-x-1" aria-hidden="true">
				{lines.map((p) => (
					<span
						key={p.id}
						className="size-3 rounded-full border-2 border-[color:var(--color-surface)]"
						style={{ backgroundColor: p.line }}
					/>
				))}
			</span>
			<span>
				<span className="text-[color:var(--color-ink)]">
					{lines.map((p) => p.name).join(', ')}
				</span>
				{lines.length === 1 ? ', no failover yet' : `, ${lines.length} lanes`}
			</span>
		</p>
	);
}

type Use = 'connector' | 'claude' | 'curl';

function Issued({
	token,
	gateway,
	onReset,
}: {
	readonly token: string;
	readonly gateway: string;
	readonly onReset: () => void;
}) {
	// The build coloured each command with slots in it; the token and gateway exist only here.
	// Escaped although neither can carry markup today: the token is base64url and the gateway an
	// origin, and "today" is not a property the HTML should depend on.
	const fill = (text: string, esc: (v: string) => string) =>
		text.replaceAll(TOKEN_SLOT, esc(token)).replaceAll(GATEWAY_SLOT, esc(gateway));
	const plain = (v: string) => v;
	// Ours only: another gateway serves `/mcp` just when its operator set PROXLANE_PUBLIC_URL, and
	// this page cannot tell from `/token-key` whether they did.
	const mcp = gateway === HOSTED_GATEWAY;
	const uses: readonly { id: Use; label: string; copy: string; what: string }[] = [
		...(mcp
			? [
					{
						id: 'connector' as const,
						label: 'connector',
						copy: `${gateway}/mcp`,
						what: 'the connector URL',
					},
				]
			: []),
		{
			id: 'claude',
			label: 'claude code',
			copy: fill(CONNECT.claude, plain),
			what: 'the Claude Code command',
		},
		{ id: 'curl', label: 'curl', copy: fill(CONNECT.curl, plain), what: 'the curl command' },
	];
	const [use, setUse] = useState<Use>(uses[0]?.id ?? 'claude');
	const current = uses.find((u) => u.id === use) ?? uses[0];
	const heading = useRef<HTMLHeadingElement>(null);
	const tabs = useId();

	// The form is gone and this replaced it in place: move focus here, or a keyboard user is left
	// on a button that no longer exists.
	useEffect(() => {
		heading.current?.focus();
		heading.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}, []);

	return (
		<div className="mt-10 flex flex-col gap-10">
			<section className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<h2
						ref={heading}
						tabIndex={-1}
						className="scroll-mt-28 font-semibold text-[color:var(--color-ink)] text-xl tracking-[-0.01em] outline-none"
					>
						Your token is ready
					</h2>
					<p className="max-w-[60ch] text-[color:var(--color-slate)] leading-relaxed">
						It is your keys, sealed: anyone holding it can spend them. Copy it somewhere safe
						now. This page keeps no copy.
					</p>
				</div>

				<Panel label="token" copy={token} what="the token">
					<p className="break-all font-mono text-[0.8125rem] text-[color:var(--color-ink)] leading-relaxed">
						{token}
					</p>
				</Panel>
			</section>

			<section className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<h3 className="font-semibold text-[color:var(--color-ink)] text-lg tracking-[-0.01em]">
						Use it
					</h3>
					<p className="text-[color:var(--color-slate)] text-sm">
						Pick where you will call Proxlane from.
					</p>
				</div>
				<div className="overflow-hidden rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] shadow-panel">
					<div className="flex min-h-11 items-center justify-between gap-4 border-[color:var(--color-rule)] border-b pr-2.5 pl-1.5">
						<div
							role="tablist"
							aria-label="Where to use the token"
							className="flex overflow-x-auto overflow-y-hidden"
						>
							{uses.map((u) => (
								<button
									key={u.id}
									type="button"
									role="tab"
									id={`${tabs}-${u.id}`}
									aria-selected={u.id === use}
									aria-controls={`${tabs}-panel`}
									onClick={() => setUse(u.id)}
									className={`focus-inset relative min-h-11 whitespace-nowrap px-2.5 font-mono text-xs transition-colors ${
										u.id === use
											? 'text-[color:var(--color-ink)] after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[color:var(--color-accent)]'
											: 'text-[color:var(--color-slate)] hover:text-[color:var(--color-ink)]'
									}`}
								>
									{u.label}
								</button>
							))}
						</div>
						{current !== undefined && <CopyButton text={current.copy} what={current.what} />}
					</div>
					<div
						role="tabpanel"
						id={`${tabs}-panel`}
						aria-labelledby={`${tabs}-${use}`}
						className="p-4"
					>
						{use === 'connector' && (
							<div className="flex flex-col gap-4">
								<p className="break-all font-mono text-[0.875rem] text-[color:var(--color-ink)]">
									{gateway}/mcp
								</p>
								<ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[color:var(--color-slate)] text-sm leading-relaxed marker:text-[color:var(--color-slate)]">
									<li>
										In claude.ai or the Claude app: Settings, Connectors, Add custom connector.
										In ChatGPT: a connector in developer mode.
									</li>
									<li>Paste this URL. It opens a Proxlane sign-in page.</li>
									<li>Paste the token above there, once. The app never sees your keys.</li>
								</ol>
							</div>
						)}
						{use === 'claude' && (
							<Code html={fill(highlighted['connect:claude'] ?? '', escapeHtml)} />
						)}
						{use === 'curl' && (
							<Code html={fill(highlighted['connect:curl'] ?? '', escapeHtml)} />
						)}
					</div>
				</div>
			</section>

			<button
				type="button"
				onClick={onReset}
				className={`${ctaClass('quiet', 'sm')} self-start`}
			>
				Seal a different set of keys
			</button>
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
