#!/usr/bin/env node
// `proxlane-mcp`: the MCP server over stdio, for Claude Code, Claude Desktop, Cursor and any other
// MCP client. Configured by environment, because that is what every client's config file passes.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const apiKey = process.env.PROXLANE_API_KEY?.trim();
if (apiKey === undefined || apiKey === '') {
	// stderr, never stdout: stdout is the protocol channel, and a stray line there breaks the client.
	process.stderr.write(
		"proxlane-mcp: set PROXLANE_API_KEY to your gateway's PROXLANE_API_KEY, or to a proxlane token for a hosted gateway.\n" +
			'Run a gateway first: https://proxlane.dev/docs/quickstart\n',
	);
	process.exit(2);
}

const gatewayUrl = process.env.PROXLANE_URL?.trim() || 'http://localhost:8787';
try {
	const u = new URL(gatewayUrl);
	if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
		process.stderr.write(
			`proxlane-mcp: PROXLANE_URL is plain http to ${u.hostname}; the gateway key travels in cleartext. Use https.\n`,
		);
	}
} catch {
	process.stderr.write('proxlane-mcp: PROXLANE_URL is not a URL.\n');
	process.exit(2);
}

const server = createServer({ gatewayUrl, apiKey });
await server.connect(new StdioServerTransport());
