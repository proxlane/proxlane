#!/usr/bin/env node
// `proxlane-mcp`: the MCP server over stdio, for Claude Code, Claude Desktop, Cursor and any other
// MCP client. Configured by environment, because that is what every client's config file passes.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const apiKey = process.env.PROXLANE_API_KEY?.trim();
if (apiKey === undefined || apiKey === '') {
	// stderr, never stdout: stdout is the protocol channel, and a stray line there breaks the client.
	process.stderr.write(
		"proxlane-mcp: set PROXLANE_API_KEY to your gateway's PROXLANE_API_KEY.\n" +
			'Run a gateway first: https://proxlane.dev/docs/quickstart\n',
	);
	process.exit(2);
}

const server = createServer({
	gatewayUrl: process.env.PROXLANE_URL?.trim() || 'http://localhost:8787',
	apiKey,
});
await server.connect(new StdioServerTransport());
