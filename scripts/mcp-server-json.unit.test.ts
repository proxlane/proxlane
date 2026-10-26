import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DESCRIPTION, listed, listingUrl, serverJson } from './mcp-server-json.js';

const sdk = JSON.parse(readFileSync('packages/sdk/package.json', 'utf8'));

describe('server.json for the MCP registry', () => {
	it('names the version in both places the registry reads it', () => {
		const s = serverJson(sdk);
		expect(s.name).toBe(sdk.mcpName);
		expect(s.version).toBe(sdk.version);
		expect(s.packages[0]).toMatchObject({ identifier: '@proxlane/sdk', version: sdk.version });
	});

	it('sits in the namespace the workflow can prove it owns', () => {
		// OIDC from proxlane/proxlane grants io.github.proxlane/*, and nothing else.
		expect(sdk.mcpName).toMatch(/^io\.github\.proxlane\//);
	});

	it('fits the registry description cap', () => {
		expect(DESCRIPTION.length).toBeLessThanOrEqual(100);
	});

	it('refuses a manifest without mcpName, before the registry does', () => {
		expect(() => serverJson({ name: '@proxlane/sdk', version: '1.0.0' })).toThrow(/mcpName/);
	});
});

describe('the listing check', () => {
	it('encodes the slash in the server name', () => {
		expect(listingUrl('io.github.proxlane/proxlane', '0.1.1')).toBe(
			'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.proxlane%2Fproxlane/versions/0.1.1',
		);
	});

	it('reads 200 and 404 as answers, and anything else as no answer', () => {
		expect(listed(200)).toBe(true);
		expect(listed(404)).toBe(false);
		// A 503 must not read as "not listed" and trigger a publish of a version that may exist.
		expect(() => listed(503)).toThrow(/503/);
	});
});
