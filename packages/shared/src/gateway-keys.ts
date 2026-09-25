// The gateway's own keys, checked at boot. Pure, and in `shared` so the gateway and
// `proxlane doctor` read one list: a refusal the gateway makes and doctor cannot explain is a
// support question with no answer.

/**
 * Keys that have appeared in public: our own CI, our docs, the integrations' CI, and the
 * placeholders a README invites.
 *
 * A key on GitHub is not a key. These are exactly the strings someone pastes into a compose
 * file to get something running. As a LIVE key that is an open proxy on their provider
 * credits, so the gateway refuses to start. As a SANDBOX key nothing is spent, but anyone can
 * hold in-flight slots and push live callers into GATEWAY_BUSY, so the gateway warns.
 *
 * A STATIC LIST, never a lookup: a boot that asked the network whether it may start would fail
 * offline and depend on a third party. Compared after `normalizeKey`, so every entry is stored
 * in that form (a test holds it there).
 *
 * Adding to this list is how a newly published key gets retired. Removing from it resurrects
 * one, so don't.
 */
export const PUBLISHED_KEYS: ReadonlySet<string> = new Set([
	// our own CI and release checks, before they moved to per-run random keys
	'ci-smoke-key',
	'manifest-check',
	'smoke-only-not-a-real-key',
	// the CI of proxlane/scrapy-proxlane and proxlane/claude-seo-proxlane, before the same move
	'ci-live-key-never-used-0000000000000000',
	'ci-sandbox-key-000000000000000000000000',
	// the placeholders our own docs print in example requests: `api_key=KEY`, `GATEWAY_KEY`, `GW_KEY`
	'key',
	'gateway_key',
	'gateway-key',
	'gw_key',
	'api_key',
	'api-key',
	'apikey',
	// the placeholders any README invites
	'changeme',
	'change-me',
	'change_me',
	'your-key',
	'your_key',
	'your-api-key',
	'your_api_key',
	'secret',
	'password',
	'test',
	'sandbox',
]);

/**
 * The form a key is compared in. Not the form it is used in: this only decides whether a value
 * is a published one, and the gateway still authenticates against the key exactly as given.
 *
 * - case and surrounding whitespace, including the `\r` a CRLF env file leaves behind and the
 *   non-breaking space a copy from a web page brings
 * - zero-width characters, which `trim()` does not remove and a copy from a web page can carry
 * - ONE pair of matching quotes, because `docker run --env-file` keeps them: an env file line
 *   `PROXLANE_API_KEY="changeme"` produces a key that is literally `"changeme"`
 */
export function normalizeKey(key: string): string {
	let k = key.replace(/[​-‍⁠﻿]/g, '').trim();
	if (k.length >= 2 && (k[0] === '"' || k[0] === "'") && k[k.length - 1] === k[0]) {
		k = k.slice(1, -1).trim();
	}
	return k.toLowerCase();
}

export function isPublishedKey(key: string): boolean {
	return PUBLISHED_KEYS.has(normalizeKey(key));
}

/**
 * Below this, warn but start. `openssl rand -hex 16`, the shortest thing the docs suggest, is 32.
 * A warning rather than a refusal, deliberately: a minimum length arriving in an upgrade would
 * stop running deployments whose key was fine yesterday, and the image auto-deploys.
 */
export const SHORT_KEY_WARNING_LENGTH = 24;

/** On success, the key itself, so the caller has it as a `string` rather than re-checking. */
export type KeyCheck =
	| { ok: true; apiKey: string; sandboxKey: string | undefined; warnings: string[] }
	| { ok: false; message: string };

const GENERATE = 'export PROXLANE_API_KEY=$(openssl rand -hex 32)';

export function checkKeys(
	apiKey: string | undefined,
	rawSandboxKey: string | undefined,
): KeyCheck {
	// An empty sandbox key is no sandbox key. Left as '', it would match the empty key a request
	// with no key at all presents, and every keyless request would become a sandbox request: the
	// same "correct only because the caller filters it" gap as the live key, closed the same way.
	// The effective value is handed back, so the gateway uses this decision rather than its own.
	const sandboxKey =
		rawSandboxKey === undefined || normalizeKey(rawSandboxKey) === ''
			? undefined
			: rawSandboxKey;
	// EMPTY IS MISSING, here and not only in the caller. An empty configured key would compare
	// equal to the empty key a request with no key at all presents, which is an open proxy. The
	// gateway's `env()` happens to turn '' into undefined first, but a check that is correct only
	// because of its caller is one refactor away from being wrong.
	if (apiKey === undefined || normalizeKey(apiKey) === '') {
		// REFUSE TO BOOT rather than run open. This gateway fetches an arbitrary URL a caller
		// chooses, on provider credentials that cost money. Started without a key it is an open
		// proxy funded by whoever deployed it, and that is the failure you cannot take back.
		return {
			ok: false,
			message:
				'PROXLANE_API_KEY is not set, and this server will not start without one.\n\n' +
				'  It authenticates callers TO the gateway. Without it anyone who can reach this\n' +
				'  port can spend your provider credits on any URL they like.\n\n' +
				`  Generate one:  ${GENERATE}`,
		};
	}

	if (isPublishedKey(apiKey)) {
		// Deliberately does not echo the key. It is published, but a boot log is not the place
		// to repeat a credential of any quality.
		return {
			ok: false,
			message:
				'PROXLANE_API_KEY is a placeholder, or a value that has been published in an example,\n' +
				'a test or a CI workflow, and this server will not start with it.\n\n' +
				'  Anyone who has read the same page knows it, which makes this gateway an open\n' +
				'  proxy on your provider credits.\n\n' +
				`  Generate one:  ${GENERATE}`,
		};
	}

	// MUST DIFFER FROM THE LIVE KEY. Equal keys would make every caller a sandbox caller: the
	// class is decided by which key matched, and the sandbox is checked first because it is the
	// one that cannot spend.
	if (sandboxKey !== undefined && sandboxKey === apiKey) {
		return {
			ok: false,
			message:
				'PROXLANE_SANDBOX_KEY equals PROXLANE_API_KEY, and this server will not start that way.\n\n' +
				'  The sandbox key is the one that can never spend. If it matched the live key, every\n' +
				'  request would be a sandbox request and nothing would ever reach a provider.\n\n' +
				'  Generate a different one:  export PROXLANE_SANDBOX_KEY=$(openssl rand -hex 32)',
		};
	}

	const warnings: string[] = [];
	if (apiKey.length < SHORT_KEY_WARNING_LENGTH) {
		warnings.push(
			`PROXLANE_API_KEY is ${apiKey.length} characters. Anything guessable can spend your ` +
				`provider credits; consider ${GENERATE}`,
		);
	}
	if (sandboxKey !== undefined && isPublishedKey(sandboxKey)) {
		// A warning, not a refusal: the sandbox cannot spend, and a published sandbox key on
		// localhost is how the try page works. On a reachable server it lets strangers hold
		// in-flight slots and shed live callers to GATEWAY_BUSY. SECURITY.md says the same.
		warnings.push(
			'PROXLANE_SANDBOX_KEY is a published value. It cannot spend, but anyone who can reach ' +
				'this port can use it to fill the in-flight ceiling and push live callers into ' +
				'GATEWAY_BUSY. Fine on localhost; on a reachable server, export ' +
				'PROXLANE_SANDBOX_KEY=$(openssl rand -hex 32)',
		);
	}
	return { ok: true, apiKey, sandboxKey, warnings };
}
