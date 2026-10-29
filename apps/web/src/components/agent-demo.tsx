/**
 * The agent station: which clients can run the MCP server, how to add it to each, and a replay of
 * an agent using it.
 *
 * EVERY CLIENT HERE RUNS A LOCAL STDIO SERVER, and that is why the list stops where it does.
 * ChatGPT, claude.ai and the Gemini app connect to MCP servers by URL from their own clouds; they
 * cannot start `npx` on your machine or reach a gateway on localhost. Naming them would advertise
 * a connection nobody can make, which is the one thing the README rule forbids.
 */

import highlighted from 'virtual:agent-setup';
import { useState } from 'react';
import { CLIENTS, KEY } from '../lib/agent-setup.js';
import { ClientMark, Roundel, Toggle } from './agent-marks.js';
import { Replay } from './agent-replay.js';
import { CopyButton } from './artifacts.js';
import { ctaClass } from './cta.js';

// ---- the station -----------------------------------------------------------------------

export function AgentStation() {
	const [clientId, setClientId] = useState(CLIENTS[0]?.id);
	const client = CLIENTS.find((c) => c.id === clientId) ?? CLIENTS[0];
	if (client === undefined) throw new Error('CLIENTS is empty');

	return (
		<div className="flex flex-col gap-6">
			<div className="-mx-2.5 flex items-center overflow-x-auto">
				{CLIENTS.map((c) => (
					<Toggle
						key={c.id}
						selected={c.id === client.id}
						onSelect={() => setClientId(c.id)}
						label={`Show setup for ${c.name}`}
					>
						<Roundel id={c.mark} selected={c.id === client.id} />
						{c.name}
					</Toggle>
				))}
			</div>

			{/* Setup beside its note, then the replay on a row of its own. Side by side with the
			    replay, the snippet and a five-beat conversation competed for one glance. */}
			<div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
				<div className="flex min-w-0 flex-col gap-4">
					<div className="overflow-hidden rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] shadow-panel">
						<div className="flex min-h-11 items-center justify-between gap-4 border-[color:var(--color-rule)] border-b pr-2.5 pl-4">
							<span className="font-mono text-[color:var(--color-slate)] text-xs">
								{client.where}
							</span>
							<CopyButton text={client.text} what={`the ${client.name} setup`} />
						</div>
						{/* EVERY CLIENT'S SNIPPET, STACKED, the live one on top. A JSON file is twice the
						    height of a one-line command, so switching tabs resized the panel and shoved
						    the replay below it up and down. The tallest now sets the height for all. */}
						<div className="grid overflow-x-auto p-4 font-mono text-[0.8125rem] leading-[1.9]">
							{CLIENTS.map((c) => (
								<div
									key={c.id}
									aria-hidden={c.id === client.id ? undefined : true}
									className={`code-hl col-start-1 row-start-1 ${c.id === client.id ? '' : 'invisible'}`}
									// Shiki's output from the build, for a string in this repo: no input reaches it.
									dangerouslySetInnerHTML={{ __html: highlighted[c.id] ?? '' }}
								/>
							))}
						</div>
					</div>
					{/* The button's slot is always there, for the same reason. */}
					{client.link !== undefined ? (
						<a className={`${ctaClass('quiet', 'sm')} self-start`} href={client.link}>
							<ClientMark id={client.mark} />
							Add to {client.name}
						</a>
					) : (
						<span
							aria-hidden="true"
							className={`${ctaClass('quiet', 'sm')} invisible self-start`}
						>
							Add to client
						</span>
					)}
				</div>
				<div className="flex min-w-0 flex-col gap-4">
					<p className="max-w-[52ch] text-[color:var(--color-slate)] text-sm leading-relaxed">
						<span className="text-[color:var(--color-ink)]">{KEY}</span> is the gateway's{' '}
						<code className="font-mono text-[0.8125rem]">PROXLANE_API_KEY</code> from the
						quickstart. Your provider keys never reach the agent.
					</p>
				</div>
			</div>

			<Replay client={client} />
		</div>
	);
}
