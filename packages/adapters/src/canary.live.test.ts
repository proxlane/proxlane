// The live canary. `pnpm test:live` — scheduled weekly, NEVER PR-blocking.
//
// This is the only test in the repo that touches a real provider, and it exists for the one
// thing nothing else can check. `integrations.md` section 6 states the gap plainly: the
// honesty check — a declared `renderJs` proved against reality — needs real keys, and
// GitHub Actions does not expose secrets to fork PRs, so it cannot run on a community PR.
// Conformance makes an adapter's shape correct; this is what makes its CLAIMS true.
//
// It is selected by FILENAME into its own vitest project, not by tag. A tag filter is one
// typo away from burning real provider credits on a fork PR, and repo:check assertion 9
// enforces that no PR-path project can match `*.live.test.ts`.
//
// Deliberately small: three requests per provider, weekly. `operations.md` budgets ~50 per
// provider per night, which is the nightly cadence for later. The point is drift detection,
// and drift does not need volume — it needs regularity.

import { providerKeyFromEnv } from '@proxlane/shared';
import { createFetchTransport, DEFAULT_BODY_CAP_BYTES } from '@proxlane/shared/transport';
import { describe, expect, it } from 'vitest';
import { type Adapter, REGISTRY } from './index.js';

/**
 * A page whose visible text exists ONLY after JavaScript runs.
 *
 * This is the whole reason the canary exists. `capabilities.renderJs: true` is a promise,
 * and the only way to falsify it is to ask a provider to render something and check the
 * result. A provider quietly dropping rendering — or us sending the wrong parameter — looks
 * exactly like success otherwise: HTTP 200, a real page, no error anywhere.
 */
/**
 * A JS-only page WE SERVE, because a launch gate should not depend on somebody else's site.
 *
 * This was a third-party scraping-demo site. It failed twice in one morning on two different
 * providers while answering in half a second from a laptop, and `operations.md` section 9
 * counts three consecutive SCHEDULED greens with no way for a manual re-dispatch to repair a
 * red one — so a demo site having a bad minute could reset a three-week clock and nothing done
 * afterwards would fix it.
 *
 * `/canary/js` is deployed from `apps/web/public/canary/js.html`. If it is down we have bigger
 * problems and already know about them. Note the extensionless path: Cloudflare's asset layer
 * 307s `.html` to it, and following a redirect through a provider is one more thing that can
 * fail for a reason unrelated to rendering.
 *
 * THE MARKER IS ABSENT FROM THE SERVED SOURCE. The page assembles it from two halves at
 * runtime, so a provider returning the unrendered document cannot satisfy this by accident —
 * which the old target never guaranteed, since its marker was plain text in the HTML that the
 * page also rendered. Verified live against all three providers before this landed: ScraperAPI,
 * ScrapingBee and Scrapfly each returned OK with the marker present.
 */
const JS_ONLY_TARGET = 'https://proxlane.dev/canary/js';
const JS_ONLY_MARKER = 'proxlane-render-ok';

const IDS = Object.keys(REGISTRY).sort();

/**
 * TRIMMED, via the same helper the gateway uses.
 *
 * This read was untrimmed and it is where the cost landed: a CI secret set with a space after
 * the colon produced AUTH_FAILED on one provider across five runs, while the same key and zone
 * returned 200 from a terminal. The canary is the thing that is supposed to tell you a provider
 * is broken, so it must not be the thing inventing the breakage.
 */
function keyFor(id: string): string | undefined {
	return providerKeyFromEnv(id);
}

/** Providers we actually hold a key for. */
const configured = IDS.filter((id) => keyFor(id) !== undefined);

// A live suite that finds no keys must FAIL, not skip. Skipping turns "the canary never ran"
// into a green board, and this is a launch gate — operations.md section 9 wants it green
// three consecutive scheduled runs, which is a claim about runs that happened.
describe('the canary has something to run against', () => {
	it('has at least one provider key', () => {
		expect(
			configured.length,
			`no provider keys in the environment. Expected one of: ${IDS.map((i) => `${i.toUpperCase()}_KEY`).join(', ')}`,
		).toBeGreaterThan(0);
	});
});

/**
 * One request, retried ONCE and only when the TARGET failed.
 *
 * WHY THIS IS NOT WEAKENING THE GATE. `operations.md` section 9 wants three consecutive
 * *scheduled* greens, and a manual re-dispatch does not repair a red one — the gate counts
 * `event == schedule`. So a third-party page having a bad minute on a Monday morning resets a
 * three-week clock and nothing anyone does afterwards fixes it. That happened twice in one
 * morning on 2026-08-25, on two different providers, against a demo site answering in 0.5s
 * from a laptop.
 *
 * `TARGET_ERROR` is the one outcome in the taxonomy that says the failure was NOT the
 * provider's. This canary exists to ask whether the provider still behaves, so a target
 * failure is not evidence either way — it is noise the gate should not be sensitive to.
 *
 * Safe here specifically: the three tests below expect `OK`, `TARGET_NOT_FOUND` and `OK`.
 * `TARGET_ERROR` is never an expected outcome, so a retry on it cannot paper over an
 * assertion. Anything the provider is blamed for — `PROVIDER_ERROR`, `PROVIDER_DRIFT`,
 * `SOFT_BLOCK`, `AUTH_FAILED` — is returned on the first attempt, unretried.
 *
 * The retry is LOUD. A provider that needs one every week is drifting toward something, and a
 * silent second chance is how that stays invisible until it is a real outage.
 */
async function attempt(id: string, url: string, renderJs: boolean) {
	const first = await attemptOnce(id, url, renderJs);
	if (first.parsed.outcome !== 'TARGET_ERROR') return first;
	process.stdout.write(
		`\n  RETRY: ${id} got TARGET_ERROR from ${new URL(url).host} — the target failed, not the ` +
			`provider. Trying once more.\n`,
	);
	await new Promise((r) => setTimeout(r, 2_000));
	const second = await attemptOnce(id, url, renderJs);
	if (second.parsed.outcome === 'TARGET_ERROR') {
		process.stdout.write(`  RETRY: ${id} got TARGET_ERROR twice. Reporting it.\n`);
	}
	return second;
}

/**
 * ONE EXECUTOR, shared with the gateway. Never a second copy of it.
 *
 * This function used to hand-roll its own `fetch`, and it dropped `wire.body`. Bright Data is
 * the only adapter that POSTs one, so it alone received a bodyless request, answered
 * `400 "zone" is required`, and was reported as AUTH_FAILED on every run — a dead credential
 * for a key that worked. The canary is the instrument the launch gate reads, so the one copy
 * that drifted was the one nothing else was watching.
 *
 * `createFetchTransport` is the gateway's own transport, which is the point: the canary now
 * exercises the code path production uses, and a capped streaming read and a real
 * timeout/abort discrimination come along with it.
 */
const transport = createFetchTransport();

async function attemptOnce(id: string, url: string, renderJs: boolean) {
	const adapter: Adapter = await (REGISTRY[id] as () => Promise<Adapter>)();
	const wire = adapter.translate(
		{
			url,
			method: 'GET',
			renderJs,
			premium: 'none',
			deadlineMs: adapter.capabilities.maxTimeoutMs,
		},
		keyFor(id) as string,
	);
	const result = await transport.execute(wire, {
		budgetMs: wire.timeoutMs,
		maxBodyBytes: DEFAULT_BODY_CAP_BYTES,
	});
	if (result.kind !== 'response') {
		// Surfaced as an assertion failure rather than a thrown transport error, so the report
		// names the provider and what the transfer did instead of a bare stack.
		throw new Error(
			`${id}: transport returned "${result.kind}" instead of a response` +
				('message' in result ? ` — ${result.message}` : ''),
		);
	}
	return { adapter, parsed: adapter.parse(result.response) };
}

describe.each(configured)('%s, against the live API', (id) => {
	it('still returns OK for a page that has always worked', async () => {
		// Drift detection at its simplest: if this stops being OK, something changed at the
		// provider and every fixture recorded from them is now suspect.
		const { parsed } = await attempt(id, 'https://httpbin.dev/html', false);
		expect(parsed.outcome).toBe('OK');
		expect(parsed.body?.byteLength ?? 0).toBeGreaterThan(0);
	}, 120_000);

	it('still maps a real 404 to TARGET_NOT_FOUND', async () => {
		// The outcome that must never fail over, and the one that costs money to get wrong:
		// ScraperAPI bills for 404s, so a provider changing how it reports one turns every
		// dead link into a paid retry across the whole chain.
		// A 404 WITH A BODY, and the distinction is not pedantry. `/status/404` answers with zero
		// bytes, and an unblocker service cannot tell an empty response from a blocked one: Bright
		// Data rejected it as `min_size` on one run and `reject_block` on the next, returning
		// `x-brd-status-code: 502` both times, so the adapter correctly reported PROVIDER_ERROR for
		// a target that was simply empty. The same provider maps a 404 that has content to 404.
		//
		// Found the day the canary first ran against Bright Data at all — until the executor fix it
		// answered AUTH_FAILED for every provider, so this target had never been exercised there.
		const { parsed } = await attempt(id, 'https://httpbin.dev/nonexistent-page-xyz', false);
		expect(parsed.outcome).toBe('TARGET_NOT_FOUND');
	}, 120_000);

	it('renders JavaScript when it says it can', async () => {
		// THE HONESTY CHECK. capabilities.renderJs is a promise the router believes: it
		// filters the failover chain on it, so a provider that silently stopped rendering
		// would be handed every renderJs request and quietly return unrendered pages.
		// Nothing but a real request against a JS-only page can tell.
		const adapter: Adapter = await (REGISTRY[id] as () => Promise<Adapter>)();
		if (!adapter.capabilities.renderJs) {
			expect(adapter.capabilities.renderJs).toBe(false);
			return;
		}
		const { parsed } = await attempt(id, JS_ONLY_TARGET, true);
		expect(parsed.outcome).toBe('OK');
		const text = new TextDecoder().decode(parsed.body ?? new Uint8Array());
		expect(
			text,
			`${id} declares renderJs but the page came back without content that only exists after JS runs`,
		).toContain(JS_ONLY_MARKER);
	}, 180_000);
});

describe('the corpus this canary defends', () => {
	it('covers every provider we hold a key for', () => {
		// Non-zero denominator, and a named gap. A canary that silently skipped two of three
		// providers would go green while two thirds of the chain drifted unnoticed.
		const skipped = IDS.filter((id) => !configured.includes(id));
		expect(configured.length).toBeGreaterThan(0);
		if (skipped.length > 0) {
			process.stdout.write(
				`\n  NOTE: no key for ${skipped.join(', ')} — those adapters were NOT checked.\n`,
			);
		}
	});
});
