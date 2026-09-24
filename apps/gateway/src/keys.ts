// The gateway's own keys, checked once at boot. Pure, so every refusal is unit-tested rather
// than living as an inline `process.exit` that nothing exercised.

/**
 * LIVE keys that have appeared in public: our own CI, our docs, and the integrations' CI.
 *
 * A key on GitHub is not a key. These are exactly the strings someone pastes into a compose
 * file to get something running, and a gateway started with one is a proxy spending real
 * provider credits for anyone who has read the same README. So they are refused, the same way
 * a missing key is.
 *
 * A STATIC LIST, never a lookup. The same reasoning as `repo:check`'s dead-host ban: a boot that
 * depended on the network to decide whether it may start would fail offline, and would make
 * startup depend on a third party.
 *
 * LIVE KEYS ONLY. A sandbox key cannot spend: it is answered from the outcome table and never
 * reaches a provider, which is why the "Try it in 60 seconds" page can print `sandbox` as one.
 *
 * Adding to this list is how a newly published key gets retired. Removing from it is how one
 * gets resurrected, so don't.
 */
export const PUBLISHED_LIVE_KEYS: ReadonlySet<string> = new Set([
	// our own CI and release checks, before they moved to per-run random keys
	'ci-smoke-key',
	'manifest-check',
	'smoke-only-not-a-real-key',
	// the CI of proxlane/scrapy-proxlane and proxlane/claude-seo-proxlane
	'ci-live-key-never-used-0000000000000000',
	// the placeholders a README invites
	'changeme',
	'change-me',
	'your-key',
	'your-api-key',
	'your_api_key',
	'secret',
	'password',
	'test',
	'sandbox',
]);

/**
 * Below this, warn but start. `openssl rand -hex 16`, the shortest thing the docs suggest, is 32.
 * A warning rather than a refusal, deliberately: a minimum length introduced by an upgrade would
 * stop running deployments whose key was fine yesterday, and the image auto-deploys.
 */
export const SHORT_KEY_WARNING_LENGTH = 24;

/** On success, the key itself: the caller gets it narrowed to `string`, not re-checked. */
export type KeyCheck =
	| { ok: true; apiKey: string; warnings: string[] }
	| { ok: false; message: string };

const GENERATE = 'export PROXLANE_API_KEY=$(openssl rand -hex 32)';

export function checkKeys(
	apiKey: string | undefined,
	sandboxKey: string | undefined,
): KeyCheck {
	if (apiKey === undefined) {
		// REFUSE TO BOOT rather than run open.
		//
		// This gateway fetches an arbitrary URL a caller chooses, on provider credentials that
		// cost money. Started without a key it is an open proxy funded by whoever deployed it,
		// and an open proxy is the failure you cannot take back: the credits are gone and the
		// abuse is already in someone's logs. Defaulting to "no auth in development" is how that
		// reaches production, because the default is what gets copied.
		return {
			ok: false,
			message:
				'PROXLANE_API_KEY is not set, and this server will not start without one.\n\n' +
				'  It authenticates callers TO the gateway. Without it anyone who can reach this\n' +
				'  port can spend your provider credits on any URL they like.\n\n' +
				`  Generate one:  ${GENERATE}`,
		};
	}

	if (PUBLISHED_LIVE_KEYS.has(apiKey.trim().toLowerCase())) {
		// Deliberately does not echo the key. It is published, but a boot log is not the place
		// to repeat a credential of any quality.
		return {
			ok: false,
			message:
				'PROXLANE_API_KEY is a value that has been published in an example, a test or a CI\n' +
				'workflow, and this server will not start with it.\n\n' +
				'  Anyone who has read the same page knows it, which makes this gateway an open\n' +
				'  proxy on your provider credits.\n\n' +
				`  Generate one:  ${GENERATE}`,
		};
	}

	// MUST DIFFER FROM THE LIVE KEY, and the boot checks it rather than the docs asking. Equal
	// keys would make every caller a sandbox caller: the class is decided by which key matched,
	// and the sandbox is checked first because it is the one that cannot spend.
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
	return { ok: true, apiKey, warnings };
}
