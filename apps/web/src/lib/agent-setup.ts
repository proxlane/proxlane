/**
 * The setup snippets for each MCP client, as data with no React in it.
 *
 * SEPARATE FROM `agent-demo.tsx` so the docs Vite plugin can import it at build time and colour
 * each snippet with the same Shiki highlighter and themes as the docs' code blocks. Highlighting
 * there, not in the page, keeps the grammars and the regex engine out of the Worker bundle, the
 * reason `design.md` gives for Shiki being a devDependency.
 *
 * THE COMMANDS WERE RUN, not transcribed. Claude Code, Gemini CLI and Codex each took the exact
 * string below against an isolated config and wrote the entry shown; Gemini reported the server
 * connected. Cursor's link and VS Code's `--add-mcp` follow each editor's own documented format.
 * `PROXLANE_URL` is left out because the server defaults to `http://localhost:8787`, which is
 * where the quickstart above puts the gateway.
 */

import type { MarkId } from '../components/agent-marks.js';

export const SERVER = { command: 'npx', args: ['-y', '@proxlane/sdk@0.1'] } as const;
export const KEY = 'your-gateway-key';
const ENV = { PROXLANE_API_KEY: KEY };

/**
 * An `mcpServers` file in three lines, the height of the commands beside it in the tab set. Every
 * snippet shares one reserved height so switching tabs moves nothing; at nine lines the JSON set
 * that height and left the one-line commands floating in an empty panel. Each value is
 * `JSON.stringify`d from the same objects the Cursor link encodes, so only the layout is by hand.
 */
const CONFIG = `{ "mcpServers": { "proxlane": {
    "command": ${JSON.stringify(SERVER.command)}, "args": ${JSON.stringify(SERVER.args).replace(',', ', ')},
    "env": ${JSON.stringify(ENV).replace(':', ': ').replace('{', '{ ').replace('}', ' }')} } } }`;

/** Cursor's documented install link: the server's config, JSON then base64, name alongside. */
const CURSOR_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=proxlane&config=${btoa(
	JSON.stringify({ ...SERVER, env: ENV }),
)}`;

export interface Client {
	readonly id: string;
	readonly name: string;
	readonly mark: MarkId;
	/** What the panel bar names: a shell, or the file the snippet goes in. */
	readonly where: string;
	readonly text: string;
	/** The grammar Shiki colours it with. */
	readonly lang: 'bash' | 'json';
	/** One click instead of a paste, where the client publishes a way to do it. */
	readonly link?: string;
}

export const CLIENTS: readonly Client[] = [
	{
		id: 'claude-code',
		name: 'Claude Code',
		mark: 'claude',
		lang: 'bash',
		where: 'terminal',
		text: `claude mcp add proxlane \\\n  --env PROXLANE_API_KEY=${KEY} \\\n  -- npx -y @proxlane/sdk@0.1`,
	},
	{
		id: 'claude-desktop',
		name: 'Claude Desktop',
		mark: 'claude',
		lang: 'json',
		where: 'claude_desktop_config.json',
		text: CONFIG,
	},
	{
		id: 'codex',
		name: 'Codex',
		mark: 'openai',
		lang: 'bash',
		where: 'terminal',
		text: `codex mcp add proxlane \\\n  --env PROXLANE_API_KEY=${KEY} \\\n  -- npx -y @proxlane/sdk@0.1`,
	},
	{
		id: 'gemini',
		name: 'Gemini CLI',
		mark: 'gemini',
		lang: 'bash',
		where: 'terminal',
		text: `gemini mcp add proxlane npx -y @proxlane/sdk@0.1 \\\n  -e PROXLANE_API_KEY=${KEY}`,
	},
	{
		id: 'cursor',
		name: 'Cursor',
		mark: 'cursor',
		lang: 'json',
		where: '~/.cursor/mcp.json',
		text: CONFIG,
		link: CURSOR_LINK,
	},
	{
		id: 'vscode',
		name: 'VS Code',
		mark: 'code',
		lang: 'bash',
		where: 'terminal',
		// Over four lines, not one. The single line ran 140 characters off the edge of the panel;
		// a newline inside single quotes is still one shell argument, and still the same JSON.
		text: `code --add-mcp '{
  "name": "proxlane", "type": "stdio", "command": ${JSON.stringify(SERVER.command)},
  "args": ${JSON.stringify(SERVER.args).replace(',', ', ')},
  "env": ${JSON.stringify(ENV).replace(':', ': ').replace('{', '{ ').replace('}', ' }')} }'`,
	},
];
