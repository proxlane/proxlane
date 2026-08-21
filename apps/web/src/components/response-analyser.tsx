/**
 * Paste a response, see what the gateway would have made of it.
 *
 * WHY THIS IS THE ONE TOOL WORTH BUILDING. Every proxy vendor's landing page says it handles
 * blocks. None of them lets you check. This runs the gateway's own detector, in the visitor's
 * browser, over bytes they already have, and then reads the consequence out of the same policy
 * table the router uses. The claim and the proof are the same code.
 *
 * IT MAKES NO REQUEST. Nothing is fetched, no target is contacted, no key exists. That is what
 * keeps it clear of `plan.md` section 18, which gates the keyless paths — `npx proxlane try`, the
 * blocked-domain checker, the playground — on provider permission and counsel. Those all reach
 * out on somebody's behalf. This is a pure function over a paste, so it needs nobody's blessing.
 *
 * THE 200 CASE ONLY, and that is `chain.ts`'s boundary rather than a shortcut: `detect` runs
 * under `outcome === 'OK' && parsed.body !== undefined`. A 403 is the adapter's verdict and
 * re-reading it would turn a 404 carrying a vendor token into a failover. It also happens to be
 * the only interesting case. Nobody needs a tool to know a 403 went wrong.
 */

import { RULES, unverifiedRules, verificationFor } from '@proxlane/detect';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { type Analysis, analyse, CONTENT_TYPES } from '../lib/analyse.js';
import { Panel } from './artifacts.js';

/** `SOFT_BLOCK` -> `soft-block`, matching the generated outcome pages. */
const slug = (outcome: string): string => outcome.toLowerCase().replace(/_/g, '-');

const kb = (n: number): string =>
	n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;

export function ResponseAnalyser() {
	const [text, setText] = useState('');
	const [contentType, setContentType] = useState<string>(CONTENT_TYPES[0]);

	// Recomputed on every keystroke, which is affordable because the detector is six string
	// scans over a bounded window and there is no network anywhere in this component.
	const result = useMemo(
		() => (text.trim() === '' ? undefined : analyse(text, contentType)),
		[text, contentType],
	);

	return (
		<div className="mt-10 flex flex-col gap-6">
			<Panel label="response body" bodyClass="p-0">
				<label className="sr-only" htmlFor="paste">
					Paste the response body your provider returned
				</label>
				<textarea
					id="paste"
					value={text}
					onChange={(e) => setText(e.target.value)}
					spellCheck={false}
					rows={10}
					placeholder="Paste the body your provider handed back with its 200."
					className="focus-inset block w-full resize-y bg-transparent p-4 font-mono text-[0.8125rem] leading-relaxed placeholder:text-[color:var(--color-slate)]"
				/>
				<div className="flex flex-wrap items-center justify-between gap-3 border-[color:var(--color-rule)] border-t px-4 py-2.5">
					<label
						className="flex items-center gap-2 font-mono text-[color:var(--color-slate)] text-xs"
						htmlFor="ct"
					>
						content-type
						<select
							id="ct"
							value={contentType}
							onChange={(e) => setContentType(e.target.value)}
							className="rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-ground)] px-2 py-1 font-mono text-[color:var(--color-ink)] text-xs"
						>
							{CONTENT_TYPES.map((c) => (
								<option key={c} value={c}>
									{c}
								</option>
							))}
						</select>
					</label>
					<span className="font-mono text-[color:var(--color-slate)] text-xs">
						{result === undefined ? 'nothing pasted' : kb(result.bytes)}
					</span>
				</div>
			</Panel>

			{result === undefined ? <Waiting /> : <Verdict result={result} />}
			<RuleList />
		</div>
	);
}

/**
 * The resting state, which is also what the server renders.
 *
 * It says what will happen rather than sitting empty, because an empty box below a textarea
 * reads as a thing that is broken until you discover otherwise.
 */
function Waiting() {
	return (
		<p className="max-w-[62ch] text-[color:var(--color-slate)] leading-relaxed">
			Nothing is sent anywhere. The detector is a few hundred lines of string matching and it
			runs in this tab, so the page works with the network off.
		</p>
	);
}

function Verdict({ result }: { readonly result: Analysis }) {
	const blocked = result.outcome === 'SOFT_BLOCK';

	// The response the gateway would have written, in the form the caller actually sees. Showing
	// headers rather than a badge is the whole point: this is the thing you would be reading in
	// your own logs, not a summary of it.
	const headers: ReadonlyArray<readonly [string, string]> = [
		['x-outcome', result.outcome],
		['x-outcome-class', result.class],
		...(result.ruleId === undefined ? [] : ([['x-detect-rule', result.ruleId]] as const)),
	];

	return (
		<div className="flex flex-col gap-6">
			<Panel label={blocked ? 'blocked' : 'served'}>
				<dl className="grid w-max grid-cols-[auto_minmax(0,1fr)] gap-x-10 font-mono text-[0.8125rem] leading-[2]">
					{headers.map(([name, value]) => (
						<div key={name} className="contents">
							<dt className="whitespace-nowrap text-[color:var(--color-slate)]">{name}</dt>
							<dd
								className={`whitespace-nowrap ${blocked ? 'text-[color:var(--color-accent)]' : ''}`}
							>
								{value}
							</dd>
						</div>
					))}
				</dl>
			</Panel>

			<p className="max-w-[62ch] leading-relaxed">
				{blocked ? (
					<>
						That is a challenge page, not the page you asked for. Your provider returned 200 and
						billed you for it.{' '}
						<Link
							className="text-[color:var(--color-accent)] underline underline-offset-4"
							to="/outcomes/$slug"
							params={{ slug: slug(result.outcome) }}
						>
							{result.outcome}
						</Link>{' '}
						is what proxlane would have called it.
					</>
				) : result.ran ? (
					<>No rule fired, so proxlane would have passed this through as {result.outcome}.</>
				) : (
					<>
						The detector does not read <span className="font-mono">{'application/json'}</span>{' '}
						bodies, so nothing examined this. That is not the same as clean, and running text
						rules over an API response is how a false positive gets invented.
					</>
				)}
			</p>

			<Consequences result={result} />

			{result.truncated && (
				<p className="max-w-[62ch] text-[color:var(--color-slate)] text-sm leading-relaxed">
					Only the first {kb(result.scanned)} were read. The gateway scans a bounded window, so
					a marker past it is genuinely not seen. Not by proxlane, and not by this page.
				</p>
			)}
		</div>
	);
}

/**
 * The cooldown scopes, in English.
 *
 * `blk` and `acct` are Valkey key namespaces and mean nothing to a reader. A lookup rather than
 * a ternary so an unmapped scope falls through to its own name — a scope added later should read
 * oddly, not read as a confident wrong sentence.
 */
const COOLDOWN_SAYS: Partial<Record<string, string>> = {
	none: 'no',
	blk: 'yes, on this provider for this domain',
	acct: 'yes, on this provider for your key',
};

/** The routing consequence, straight out of `FAILOVER`. Never a second copy of the table. */
function Consequences({ result }: { readonly result: Analysis }) {
	const rows: ReadonlyArray<readonly [string, string]> = [
		[
			'status your caller sees',
			result.httpStatus === 'upstream' ? "the provider's own" : String(result.httpStatus),
		],
		[
			'moves to the next provider',
			result.failover === true ? 'yes' : result.failover === 'once' ? 'once' : 'no',
		],
		[
			'arms a cooldown',
			COOLDOWN_SAYS[result.cooldown] ?? `yes, scoped ${String(result.cooldown)}`,
		],
		[
			'hosted billing charges',
			result.chargeable === true
				? 'yes'
				: result.chargeable === false
					? 'no'
					: 'depends on the provider',
		],
	];
	return (
		<Panel label="what proxlane does next" bodyClass="p-0">
			{/* STACKED ON A PHONE, and left-aligned there. Kept as two columns, the cooldown answer
			    wrapped over five right-aligned lines, which is the one layout worse than either
			    stacking or truncating. Right alignment only earns its keep when the value is short
			    enough to stay on one line. */}
			<dl className="grid gap-x-6 font-mono text-[0.8125rem] sm:grid-cols-[auto_1fr]">
				{rows.map(([k, v], i) => (
					<div
						key={k}
						className={`px-4 py-3 sm:col-span-2 sm:grid sm:grid-cols-subgrid ${i > 0 ? 'border-[color:var(--color-rule)] border-t' : ''}`}
					>
						<dt className="text-[color:var(--color-slate)]">{k}</dt>
						<dd className="mt-1 sm:mt-0 sm:text-right">{v}</dd>
					</div>
				))}
			</dl>
		</Panel>
	);
}

/**
 * Every rule, and whether a real capture has ever backed it.
 *
 * SAYING THIS OUT LOUD IS THE POINT. `state.md` records that the detector has never seen a real
 * block page, and a test asserts the count. Six confident-looking vendor names with nothing
 * behind them would be the ordinary way to present this. Naming the gap is both honest and the
 * clearest possible ask: the corpus is what the project needs next.
 */
/**
 * What confirmed a rule, in a sentence.
 *
 * Reads the generated table rather than restating it: `captures` and `classes` are written by
 * `pnpm corpus:verify` from real captures, and the capture bodies themselves are not in this
 * repository. Section 19 asks for classes of target and never names, which is exactly what the
 * table holds, so this can print it verbatim.
 */
function describeVerification(id: string): string {
	const v = verificationFor(id);
	if (v === undefined) return '';
	const n = v.captures === 1 ? '1 real capture' : `${v.captures} real captures`;
	return `confirmed against ${n} (${v.classes.join(', ')}), ${v.lastVerified}`;
}

function RuleList() {
	const unverified = new Set(unverifiedRules());
	return (
		<Panel label={`${RULES.length} rules`} bodyClass="p-0">
			{/* ONE COLUMN ON A PHONE. A nowrap mono id beside a sentence needs two columns of room,
			    and at 390px the sentence had nowhere to go but off the right edge of a panel that
			    clips — so the page did not overflow and the text was still unreadable. */}
			<dl className="grid gap-x-6 text-[0.8125rem] sm:grid-cols-[auto_1fr]">
				{RULES.map((rule, i) => (
					<div
						key={rule.id}
						className={`px-4 py-3 sm:col-span-2 sm:grid sm:grid-cols-subgrid ${i > 0 ? 'border-[color:var(--color-rule)] border-t' : ''}`}
					>
						<dt className="font-mono sm:whitespace-nowrap">{rule.id}</dt>
						<dd className="mt-1 text-[color:var(--color-slate)] sm:mt-0">
							{rule.source}
							{/* THE POSITIVE, not just the absence of the warning. A rule with nothing said
							    about it reads as unremarkable; saying what confirmed it is the claim.
							    Both halves come from the generated table, so neither can be typed. */}
							{unverified.has(rule.id) ? (
								<span className="mt-1 block font-mono text-[color:var(--color-accent)] text-xs">
									no real capture yet
								</span>
							) : (
								<span className="mt-1 block font-mono text-[color:var(--color-slate)] text-xs">
									{describeVerification(rule.id)}
								</span>
							)}
						</dd>
					</div>
				))}
			</dl>
		</Panel>
	);
}
