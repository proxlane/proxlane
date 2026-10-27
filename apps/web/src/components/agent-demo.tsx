/**
 * The agent station: which clients can run the MCP server, and how to add it to each.
 *
 * EVERY CLIENT HERE RUNS A LOCAL STDIO SERVER, and that is why the list stops where it does.
 * ChatGPT, claude.ai and the Gemini app connect to MCP servers by URL from their own clouds; they
 * cannot start `npx` on your machine or reach a gateway on localhost. Naming them would advertise
 * a connection nobody can make, which is the one thing the README rule forbids.
 *
 * THE COMMANDS WERE RUN, not transcribed. Claude Code, Gemini CLI and Codex each took the exact
 * string below against an isolated config and wrote the entry shown; Gemini reported the server
 * connected. Cursor's link and VS Code's `--add-mcp` follow each editor's own documented format.
 * `PROXLANE_URL` is left out because the server defaults to `http://localhost:8787`, which is
 * where the quickstart above puts the gateway.
 */

import { useState } from 'react';
import { ClientMark, type MarkId, Toggle } from './agent-marks.js';
import { CopyButton } from './artifacts.js';
import { ctaClass } from './cta.js';

const SERVER = { command: 'npx', args: ['-y', '@proxlane/sdk@0.1'] } as const;
const KEY = 'your-gateway-key';
const ENV = { PROXLANE_API_KEY: KEY };

/** An `mcpServers` file, with the two-item `args` kept on one line the way people write it. */
const CONFIG = JSON.stringify(
	{ mcpServers: { proxlane: { ...SERVER, env: ENV } } },
	null,
	2,
).replace(/\[\s+("[^"]*"),\s+("[^"]*")\s+\]/, '[$1, $2]');

/** Cursor's documented install link: the server's config, JSON then base64, name alongside. */
const CURSOR_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=proxlane&config=${btoa(
	JSON.stringify({ ...SERVER, env: ENV }),
)}`;

interface Client {
	readonly id: string;
	readonly name: string;
	readonly mark?: MarkId;
	/** What the panel bar names: a shell, or the file the snippet goes in. */
	readonly where: string;
	readonly text: string;
	/** One click instead of a paste, where the client publishes a way to do it. */
	readonly link?: string;
}

export const CLIENTS: readonly Client[] = [
	{
		id: 'claude-code',
		name: 'Claude Code',
		mark: 'claude',
		where: 'terminal',
		text: `claude mcp add proxlane \\\n  --env PROXLANE_API_KEY=${KEY} \\\n  -- npx -y @proxlane/sdk@0.1`,
	},
	{
		id: 'claude-desktop',
		name: 'Claude Desktop',
		mark: 'claude',
		where: 'claude_desktop_config.json',
		text: CONFIG,
	},
	{
		id: 'codex',
		name: 'Codex',
		where: 'terminal',
		text: `codex mcp add proxlane \\\n  --env PROXLANE_API_KEY=${KEY} \\\n  -- npx -y @proxlane/sdk@0.1`,
	},
	{
		id: 'gemini',
		name: 'Gemini CLI',
		mark: 'gemini',
		where: 'terminal',
		text: `gemini mcp add proxlane npx -y @proxlane/sdk@0.1 \\\n  -e PROXLANE_API_KEY=${KEY}`,
	},
	{
		id: 'cursor',
		name: 'Cursor',
		mark: 'cursor',
		where: '~/.cursor/mcp.json',
		text: CONFIG,
		link: CURSOR_LINK,
	},
	{
		id: 'vscode',
		name: 'VS Code',
		where: 'terminal',
		text: `code --add-mcp '${JSON.stringify({ name: 'proxlane', type: 'stdio', ...SERVER, env: ENV })}'`,
	},
];

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
						{c.mark !== undefined && <ClientMark id={c.mark} className="size-[18px]" />}
						{c.name}
					</Toggle>
				))}
			</div>

			<div className="grid gap-6 lg:max-w-[40rem]">
				<div className="flex min-w-0 flex-col gap-4">
					<div className="overflow-hidden rounded-card border border-[color:var(--color-rule)] bg-[color:var(--color-surface)] shadow-panel">
						<div className="flex min-h-11 items-center justify-between gap-4 border-[color:var(--color-rule)] border-b pr-2.5 pl-4">
							<span className="font-mono text-[color:var(--color-slate)] text-xs">
								{client.where}
							</span>
							<CopyButton text={client.text} what={`the ${client.name} setup`} />
						</div>
						<pre className="overflow-x-auto whitespace-pre p-4 font-mono text-[0.8125rem] leading-[1.9]">
							<code>{client.text}</code>
						</pre>
					</div>
					{client.link !== undefined && (
						<a className={`${ctaClass('quiet', 'sm')} self-start`} href={client.link}>
							{client.mark !== undefined && <ClientMark id={client.mark} />}
							Add to {client.name}
						</a>
					)}
					<p className="max-w-[52ch] text-[color:var(--color-slate)] text-sm leading-relaxed">
						<span className="text-[color:var(--color-ink)]">{KEY}</span> is the gateway's own{' '}
						<code className="font-mono text-[0.8125rem]">PROXLANE_API_KEY</code>, from the
						quickstart above. Your provider keys stay on the gateway; the agent never sees them.
						One tool, <code className="font-mono text-[0.8125rem]">fetch_page</code>, with
						rendering, a wait-for selector and a country.
					</p>
				</div>
			</div>
		</div>
	);
}
