// The MCP server: one tool, `fetch_page`, through the caller's own Proxlane gateway.
//
// WHY AN AGENT WANTS THIS. A plain fetch hands an agent a 200 with a captcha in the body, and the
// agent summarises the captcha. The gateway already knows better: it fails over between scraping
// APIs, runs every page through a block detector, and says in headers what happened. This tool
// turns those headers into the two things a model can act on: the page, or a failure that says
// whether trying again is worth it. A failed fetch is never handed over as content.
//
// It talks to a gateway the user runs, with the user's own provider keys. There is no hosted
// endpoint and no keyless path; `plan.md` section 18 keeps it that way.

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { carriesBody, OUTCOMES, type Outcome } from '@proxlane/shared/outcome';
import { z } from 'zod';
import { htmlToText, titleOf } from './text.js';

const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string })
	.version;

export interface ServerConfig {
	/** The gateway's base URL, e.g. `http://localhost:8787`. */
	readonly gatewayUrl: string;
	/** The gateway's `PROXLANE_API_KEY`. Sent as a bearer token, never in the URL. */
	readonly apiKey: string;
	/** Injected in tests; the global `fetch` otherwise. */
	readonly fetch?: typeof fetch;
}

/**
 * Whether a failure is worth retrying, by outcome class, the closed set the gateway promises
 * (`docs/agents.md`). `target` is the site's own answer and `client` is the request; trying again
 * changes neither. The rest are blocks and provider or account trouble the gateway already failed
 * over through, so a later retry, not an immediate one, may succeed.
 */
const RETRYABLE: Readonly<Record<string, boolean>> = {
	target: false,
	client: false,
	blocked: true,
	provider: true,
	gateway: true,
};

/** How long one fetch may take, end to end. A failover chain on a slow page needs the room. */
const TIMEOUT_MS = 120_000;

function failure(fields: Record<string, unknown>): CallToolResult {
	return {
		isError: true,
		content: [{ type: 'text', text: JSON.stringify({ ok: false, ...fields }) }],
	};
}

export function createServer(config: ServerConfig): McpServer {
	const doFetch = config.fetch ?? fetch;
	const base = config.gatewayUrl.replace(/\/+$/, '');
	// For messages only: a URL with credentials in it is never repeated into a model's context.
	const shown = (() => {
		try {
			const u = new URL(base);
			u.username = '';
			u.password = '';
			return u.toString().replace(/\/$/, '');
		} catch {
			return 'the configured PROXLANE_URL';
		}
	})();
	const server = new McpServer({ name: 'proxlane', version: VERSION });

	server.registerTool(
		'fetch_page',
		{
			title: 'Fetch a web page',
			description:
				'Fetch a web page through a Proxlane gateway, which fails over between ' +
				'scraping APIs and checks every response for block pages. Returns the page as text. ' +
				'On failure returns {ok:false, outcome, class, retryable, reason}: a blocked or ' +
				'captcha page is reported as a failure, never returned as content. Do not retry ' +
				'immediately when retryable is true; the gateway has already tried other providers.',
			inputSchema: {
				url: z
					.string()
					.url()
					.refine((u) => /^https?:\/\//i.test(u), 'only http and https URLs')
					.describe('The page to fetch, http or https.'),
				render: z
					.boolean()
					.optional()
					.describe(
						'Run JavaScript before the snapshot. Costs several times more; use only when the page needs it.',
					),
				wait_for: z
					.string()
					.min(1)
					.max(256)
					.optional()
					.describe(
						'A CSS selector to wait for before the snapshot. Implies render. The page is a failure if it never appears.',
					),
				country: z
					.string()
					.regex(/^[a-zA-Z]{2}$/)
					.optional()
					.describe('Two-letter country to fetch from, e.g. "us" or "de".'),
				format: z
					.enum(['text', 'html'])
					.default('text')
					.describe('"text" (default) for readable text, "html" for the raw page.'),
				max_chars: z
					.number()
					.int()
					.min(1000)
					.max(200_000)
					.default(20_000)
					.describe('Truncate the result to this many characters.'),
			},
			// NOT readOnlyHint, though nothing local changes: some clients auto-approve read-only tools,
			// and every call spends provider credits, several times more with render or wait_for.
			annotations: { openWorldHint: true },
		},
		async ({ url, render, wait_for, country, format, max_chars }) => {
			const q = new URLSearchParams({ url });
			if (render === true) q.set('render', 'true');
			if (wait_for !== undefined) q.set('wait_for', wait_for);
			if (country !== undefined) q.set('country_code', country.toLowerCase());

			let res: Response;
			let raw: string;
			try {
				res = await doFetch(`${base}/v1?${q}`, {
					headers: { authorization: `Bearer ${config.apiKey}` },
					// The gateway never redirects; one means PROXLANE_URL points somewhere else.
					redirect: 'error',
					signal: AbortSignal.timeout(TIMEOUT_MS),
				});
				// Read inside the same try and timeout: a stall mid-body is a timeout verdict too.
				raw = await res.text();
			} catch (err) {
				const timedOut = err instanceof Error && err.name === 'TimeoutError';
				return failure({
					outcome: timedOut ? 'TOOL_TIMEOUT' : 'GATEWAY_UNREACHABLE',
					class: 'gateway',
					retryable: true,
					reason: timedOut
						? `no answer from the gateway within ${TIMEOUT_MS / 1000}s`
						: `could not reach the Proxlane gateway at ${shown}; is it running? (PROXLANE_URL)`,
				});
			}

			const outcome = res.headers.get('x-outcome') ?? undefined;
			const cls = res.headers.get('x-outcome-class') ?? undefined;
			const provider = res.headers.get('x-provider-used') ?? undefined;
			const chain = res.headers.get('x-chain') ?? undefined;

			// THE GATEWAY'S OWN REFUSAL, before any scrape: a code that is not an outcome, so no
			// `X-Outcome`, but always an `X-Outcome-Class`. Both conditions, so a server that is not a
			// gateway (a wrong PROXLANE_URL) cannot put its own JSON into `reason`. Its message is the
			// gateway's, written to be read: "this token was sealed to a key this gateway no longer
			// holds" is what a hosted user needs, and a fixed sentence about PROXLANE_API_KEY was not.
			let refusal: { code?: string; message?: string } = {};
			if (outcome === undefined && cls !== undefined) {
				try {
					const e = (JSON.parse(raw) as { error?: { code?: unknown; message?: unknown } })
						.error;
					refusal = {
						...(typeof e?.code === 'string' ? { code: e.code.slice(0, 40) } : {}),
						...(typeof e?.message === 'string' ? { message: e.message.slice(0, 300) } : {}),
					};
				} catch {
					// No body to read; the status and class still answer.
				}
			}

			if (res.status === 401) {
				return failure({
					outcome: 'UNAUTHORIZED',
					class: 'client',
					retryable: false,
					reason:
						refusal.message ??
						"the gateway refused the key in PROXLANE_API_KEY: the gateway's own PROXLANE_API_KEY, or a proxlane token for a hosted gateway",
				});
			}

			if (refusal.code === 'TOO_MANY_REQUESTS') {
				// Retryable, unlike the rest of `client`: slowing down is the whole fix.
				const after = Number(res.headers.get('retry-after'));
				return failure({
					outcome: 'TOO_MANY_REQUESTS',
					class: 'client',
					retryable: true,
					...(Number.isFinite(after) && after > 0 ? { retry_after_s: after } : {}),
					...(refusal.message === undefined ? {} : { reason: refusal.message }),
				});
			}

			if (cls === 'ok') {
				const title = format === 'text' ? titleOf(raw) : undefined;
				const body = format === 'text' ? htmlToText(raw) : raw;
				const text = title === undefined ? body : `# ${title}\n\n${body}`;
				const truncated = text.length > max_chars;
				return {
					content: [
						{
							type: 'text',
							text: truncated
								? `${text.slice(0, max_chars)}\n\n[truncated at ${max_chars} of ${text.length} characters]`
								: text,
						},
					],
					structuredContent: {
						ok: true,
						url,
						...(provider === undefined ? {} : { provider }),
						...(chain === undefined ? {} : { chain }),
						truncated,
					},
				};
			}

			// A failure. The body is the gateway's JSON error, or, for an outcome that carries the
			// page (a block page, a 404, a page without the wait_for element), the TARGET's page, which
			// must not reach the model at all. So the body is read as the gateway's error ONLY for an
			// outcome known not to carry the page. Reading any JSON let a target's own JSON page,
			// shaped like our error, put its words into `reason` as though the gateway had said them.
			const known = (OUTCOMES as readonly string[]).includes(outcome ?? '');
			const gatewaysOwn = known && !carriesBody(outcome as Outcome);
			let reason: string | undefined;
			let providerSaid: string[] = [];
			if (gatewaysOwn && (res.headers.get('content-type') ?? '').includes('json')) {
				try {
					const body = JSON.parse(raw) as {
						error?: { message?: unknown };
						attempts?: { provider?: unknown; providerMessage?: unknown }[];
					};
					if (typeof body.error?.message === 'string') reason = body.error.message;
					providerSaid = (body.attempts ?? []).flatMap((a) =>
						typeof a.providerMessage === 'string' && typeof a.provider === 'string'
							? [`${a.provider}: ${a.providerMessage}`]
							: [],
					);
				} catch {
					// An unreadable error body leaves the headers, which are the contract anyway.
				}
			}
			reason ??= refusal.message;
			return failure({
				outcome: outcome ?? refusal.code ?? `HTTP_${res.status}`,
				class: cls ?? 'gateway',
				retryable: RETRYABLE[cls ?? 'gateway'] ?? true,
				...(reason === undefined ? {} : { reason }),
				...(providerSaid.length === 0 ? {} : { provider_said: providerSaid }),
				...(chain === undefined ? {} : { chain }),
			});
		},
	);

	return server;
}
