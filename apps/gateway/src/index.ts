// The server. Wiring only: what to run, with which keys, on which port.
//
// Every decision lives elsewhere — the chain decides routing, FAILOVER decides retries,
// the adapters decide translation. This file exists so that `pnpm dev` runs the real thing.

import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { serve } from '@hono/node-server';
import { type Adapter, REGISTRY } from '@proxlane/adapters';
import {
	assessMemory,
	describeSource,
	overBudgetMessage,
	providerKeyFromEnv,
	readMemoryLimit,
} from '@proxlane/shared';
import { Redis } from 'ioredis';
import { createApp } from './app.js';
import { type CooldownStore, InMemoryCooldownStore } from './cooldown-store.js';
import { assertSingleWriter, type HealthStore, InMemoryHealthStore } from './health-store.js';
import { createLogger } from './log.js';
import { Prober } from './prober.js';
import { createFetchTransport } from './transport.js';
import { ValkeyCooldownStore, ValkeyHealthStore } from './valkey.js';
import { VERSION } from './version.js';

const PORT = Number(process.env.PORT ?? 8787);
// 120s, which `operations.md` section 1 decided and this file had not caught up with. At the
// old 90s a three-hop chain could not reach its terminal cap: the first two hops take 22s
// each and `hopBudget` reserves 8s for every hop still to come, leaving the last provider
// 38s of its 70s. Failover is the product, so the hop that exists to save the request was
// the one being cut short. Measured, not reasoned: at 120s the same chain gives it 68s.
const DEFAULT_DEADLINE_MS = Number(env('PROXLANE_DEADLINE_MS') ?? 120_000);
// Empty would read as 0 here, i.e. a body cap of nothing, which rejects every response.
const MAX_BODY_BYTES = Number(env('PROXLANE_BODY_CAP_MB') ?? 10) * 1024 * 1024;

// The in-flight ceiling. 32 is `plan.md`'s sizing for this deployment: ~1 GB of container
// memory against a 10 MB body cap at the 2.5x buffering factor `operations.md` section 1
// uses, i.e. 1024 / (10 * 2.5) ≈ 40, rounded down to leave headroom.
//
// Raising it without raising the memory limit trades a 429 for an OOM kill, which is the
// worse failure by a distance: the 429 refuses one request and the OOM drops every in-flight
// scrape and restarts the process. `InflightLimiter` rejects a non-positive or fractional
// value at construction, so a typo here fails the boot rather than the ceiling.
const MAX_INFLIGHT = Number(env('PROXLANE_MAX_INFLIGHT') ?? 32);
/** Filled by the sizing check below, printed in the boot banner. */
let MEMORY_NOTE = '';

/**
 * Read an env var, treating empty as absent.
 *
 * Docker Compose cannot express "leave this variable unset" for an optional value: the
 * conventional `${VAR:-}` always defines it. Anything reading `process.env` directly and
 * testing `undefined` is therefore wrong under the one deployment path this project ships.
 */
function env(name: string): string | undefined {
	const v = process.env[name];
	return v === undefined || v.trim() === '' ? undefined : v;
}

// Health tracking is OFF by default, and that is a retreat from the previous default.
//
// Its calibration assumes independent Bernoulli trials, and providers do not produce them.
// Measured in `scripts/health-sim.ts`: a two-regime provider with an IDENTICAL 5% mean
// failure rate — a bad hour, a struggling upstream, a diurnal pattern — spends over 90% of
// its time demoted, against 1.7% for the iid stream every published specificity figure was
// derived from. The exit path is slower than the regime dynamics, so one bad patch buys
// hours out of rotation.
//
// The statistic is not wrong; the claim that it is safe to leave on unattended was. Turning
// it on is a deliberate act until the calibration is validated against autocorrelated
// traffic, which needs real traffic to validate against.
//
// Cooldowns stay ON: they act on facts a provider just told us, not on inference.
const HEALTH_ENABLED = (env('PROXLANE_HEALTH') ?? 'off') === 'on';

// Cooldowns are ON by default for the same reason: asking a provider something it refused
// ninety seconds ago costs money and usually gets refused again.
const COOLDOWNS_ENABLED = (env('PROXLANE_COOLDOWNS') ?? 'on') !== 'off';

/**
 * Extra goes at the LAST capable provider before the chain gives up. 0 disables it.
 *
 * Deliberately NOT a general retry knob, and the name says so. Anywhere but the terminal
 * hop, failing over to a different provider is both cheaper and likelier to work than asking
 * the same one twice — see `chain.ts`. What this tunes is the case with nowhere left to go,
 * which is what a single-provider deployment is on every request.
 *
 * Bounded rather than trusted: a fat-fingered 500 here would spend a request per go until
 * the deadline stopped it, and the deadline is the only thing that would. Ten is far above
 * any real setting and well below a bill.
 */
const TERMINAL_RETRIES = Number(env('PROXLANE_TERMINAL_RETRIES') ?? 1);
if (!Number.isInteger(TERMINAL_RETRIES) || TERMINAL_RETRIES < 0 || TERMINAL_RETRIES > 10) {
	process.stderr.write(
		`\n  PROXLANE_TERMINAL_RETRIES must be a whole number from 0 to 10.\n` +
			`  Got: ${JSON.stringify(env('PROXLANE_TERMINAL_RETRIES'))}\n\n`,
	);
	process.exit(1);
}

// Valkey is what makes more than one replica possible: both stores become shared instead of
// process-local. Set PROXLANE_VALKEY_URL to use it.
//
// Not required, and that is deliberate. Self-host is one process, and a mandatory Valkey
// would add a service, a failure mode and a compose entry to a deployment that does not need
// one. `docker/compose.yml` ships it commented out with this paragraph's reasoning.
//
// EMPTY STRING MEANS UNSET, and that is not defensive coding for its own sake. Compose
// interpolates `${PROXLANE_VALKEY_URL:-}` to `""` rather than omitting the variable, so a
// default self-host deployment — nobody having touched anything — arrived here with `''`,
// built `new Redis('')`, and spent its life logging ECONNREFUSED while `/health/providers`
// returned 500. The boot banner even claimed `state: valkey (shared)`. Every one of the ten
// PR checks passed, because none of them start the shipped compose file.
const VALKEY_URL = env('PROXLANE_VALKEY_URL');

// Namespaces this deployment's account-scoped state.
//
// `cd:acct:{org}:{provider}` and `hs:{provider}` are shared the moment two gateways point at
// one Valkey, and until now nothing filled the org slot: every deployment wrote
// `cd:acct:self:…`. One gateway with an expired provider key would cool that provider for the
// other, and a staging gateway pointed at prod's Valkey would write prod's health state.
//
// Defaults to `self`, which is correct for the single deployment self-host actually is.
const ORG_ID = env('PROXLANE_ORG_ID') ?? 'self';

// Process-local state means a second replica keeps a second opinion and demotes
// independently. Refuse rather than misroute — unless Valkey is backing them, in which case
// the state is shared and replicas are fine.
if (VALKEY_URL === undefined) {
	assertSingleWriter(env('PROXLANE_REPLICAS') ?? '1');
}

// WILL THIS FIT IN THE MEMORY IT HAS? Checked before anything is allocated.
//
// The gateway buffers every response body for the detector, so the working set is roughly
// `maxInflight * bodyCap * 2.5`. Over the container's limit that is not a slow degradation,
// it is an OOM kill: every in-flight scrape dropped, nothing logged by us, and the only
// evidence a line in the host's dmesg.
//
// REFUSING IS THE HOUSE STYLE, and it is the same call made for a missing API key and for
// more than one replica without shared state: a loud failure that names the fix beats a
// deployment that misbehaves under load. The escape hatch is not a flag but
// PROXLANE_MEMORY_LIMIT_MB — an operator who thinks the arithmetic is too conservative states
// their real limit, rather than being handed a switch that ends up on everywhere.
//
// UNKNOWN NEVER REFUSES. There is no cgroup file on macOS, on any BSD, or on bare-metal Linux
// without cgroup v2, and `pnpm dev` is a contract command that has to run on a laptop.
{
	const readIfPresent = (path: string): string | undefined => {
		try {
			return readFileSync(path, 'utf8');
		} catch {
			return undefined;
		}
	};
	const budget = assessMemory(
		MAX_INFLIGHT,
		MAX_BODY_BYTES / 1024 / 1024,
		readMemoryLimit(readIfPresent, env),
	);
	if (budget.verdict === 'over') {
		process.stderr.write(overBudgetMessage(budget, MAX_INFLIGHT, MAX_BODY_BYTES / 1024 / 1024));
		process.exit(2);
	}
	if (budget.verdict === 'unknown') {
		// Once, at boot, and not on every request. It is information, not a problem.
		process.stderr.write(
			`\n  NOTE: no container memory limit is readable, so the sizing check was skipped.\n` +
				`  This configuration wants about ${budget.needMb} MB. Set PROXLANE_MEMORY_LIMIT_MB to\n` +
				`  have it checked, or lower PROXLANE_MAX_INFLIGHT on a small box.\n\n`,
		);
	}
	MEMORY_NOTE =
		budget.verdict === 'unknown'
			? `~${budget.needMb} MB wanted, ${describeSource(budget.limit.source)}`
			: `~${budget.needMb} MB of ${budget.limit.limitMb} MB (${describeSource(budget.limit.source)})`;
}

const apiKey = env('PROXLANE_API_KEY');
if (apiKey === undefined) {
	// REFUSE TO BOOT rather than run open.
	//
	// This gateway fetches an arbitrary URL a caller chooses, on provider credentials that
	// cost money. Started without a key it is an open proxy funded by whoever deployed it,
	// and an open proxy is the failure you cannot take back — the credits are gone and the
	// abuse is already in someone's logs. Defaulting to "no auth in development" is how that
	// reaches production, because the default is what gets copied.
	process.stderr.write(
		'\nPROXLANE_API_KEY is not set, and this server will not start without one.\n\n' +
			'  It authenticates callers TO the gateway. Without it anyone who can reach this\n' +
			'  port can spend your provider credits on any URL they like.\n\n' +
			`  Generate one:  export PROXLANE_API_KEY=$(openssl rand -hex 32)\n\n`,
	);
	process.exit(2);
}

// BYOK: provider keys come from the environment and never leave this process. A provider
// with no key is not a broken configuration, it is a provider you have not signed up for,
// so it is left out of the chain rather than failing the boot.
/**
 * The order the chain tries providers in, before health re-ranks it.
 *
 * This was `Object.keys(REGISTRY).sort()` — ALPHABETICAL. Nobody chose it, and
 * `integrations.md` refers twice to a "static priority list" that did not exist. An ordering
 * arrived at by the alphabet is not a priority list; it is the absence of one wearing its
 * clothes, and it decides which provider gets paid first on every request.
 *
 * The default below is DELIBERATE BUT NOT EVIDENCE-BASED, and that distinction matters. A
 * competitor's published benchmark rates these providers very differently from each other on
 * protected targets, but a benchmark published by a rival scraping API about rival scraping
 * APIs is not a source to reorder production traffic on. The honest position is that we do
 * not yet have our own data — and measuring exactly this is what the product is for. The
 * health statistic already ranks by observed behaviour, and the phase-3 scoreboard will rank
 * per domain.
 *
 * So: explicit, overridable, and provisional. `PROXLANE_PROVIDER_ORDER` takes a comma-
 * separated list; anything omitted keeps its registry position behind those named.
 */
const DEFAULT_PROVIDER_ORDER = ['scraperapi', 'scrapfly', 'scrapingbee'] as const;

function providerOrder(): string[] {
	const ids = Object.keys(REGISTRY);
	const requested = (env('PROXLANE_PROVIDER_ORDER') ?? DEFAULT_PROVIDER_ORDER.join(','))
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	const unknown = requested.filter((id) => !ids.includes(id));
	if (unknown.length > 0) {
		// Refuse rather than silently ignore. A typo here quietly changes which provider is
		// paid first, and there is no symptom to notice.
		process.stderr.write(
			`\n  PROXLANE_PROVIDER_ORDER names unknown provider(s): ${unknown.join(', ')}\n` +
				`  Known: ${ids.sort().join(', ')}\n\n`,
		);
		process.exit(1);
	}
	// Anything unnamed keeps a stable position behind the named ones, so adding an adapter
	// cannot silently jump the queue.
	return [...requested, ...ids.filter((id) => !requested.includes(id)).sort()];
}

const candidates: { adapter: Adapter; key: string }[] = [];
for (const id of providerOrder()) {
	const adapter = await (REGISTRY[id] as () => Promise<Adapter>)();
	// TRIMMED at the boundary. A leading space in the value survives into
	// `Authorization: Bearer  <key>` and the provider answers 401, which surfaces as
	// AUTH_FAILED and points at the key rather than at the whitespace. See `providerKeyFromEnv`.
	const key = providerKeyFromEnv(id);
	if (key === undefined) continue;
	candidates.push({ adapter, key });
}

if (candidates.length === 0) {
	// WARN, do not exit — and the difference from PROXLANE_API_KEY above is the point.
	//
	// Refusing to boot without the gateway key prevents an open proxy, which is
	// unrecoverable. Refusing to boot without a PROVIDER key prevents nothing: it just means
	// someone evaluating this with `docker compose up`, before signing up for anything, gets
	// a crash loop instead of a working service they can curl. `proxlane doctor` already
	// treats a missing BYOK key as information for exactly that reason.
	//
	// The failure is already well defined and visible: every scrape returns
	// NO_PROVIDER_AVAILABLE, /health reports the count, and this warning names the fix.
	process.stderr.write(
		'\n  WARNING: no provider keys found. The gateway is up, but every scrape will\n' +
			'  return NO_PROVIDER_AVAILABLE until you set one, e.g. SCRAPERAPI_KEY.\n' +
			'  `npx proxlane providers` lists the exact variable per provider.\n\n',
	);
}

const redis =
	VALKEY_URL === undefined
		? undefined
		: new Redis(VALKEY_URL, {
				// A gateway that cannot reach Valkey must still serve: both stores fail open, and
				// an unbounded retry queue would hold requests instead of letting them through.
				maxRetriesPerRequest: 1,
				enableOfflineQueue: false,
			});

const transport = createFetchTransport();
/** Identifies which replica holds a probe lease, so a stuck lock is traceable. */
const HOSTNAME = hostname();

let health: HealthStore | undefined;
let cooldowns: CooldownStore | undefined;
if (redis === undefined) {
	const inMemoryCooldowns = new InMemoryCooldownStore();
	// Expired entries are keyed by (provider, domain) and nothing else would ever remove
	// them, so a long-lived gateway with wide traffic leaks one entry per host it has been
	// blocked on. Valkey gets this free from key TTLs. In memory it has to be swept, and
	// `unref` so an idle timer never holds the process open — which is how a graceful
	// shutdown becomes a hang.
	if (COOLDOWNS_ENABLED) {
		setInterval(() => inMemoryCooldowns.sweep(Date.now()), 10 * 60 * 1000).unref();
	}
	health = HEALTH_ENABLED ? new InMemoryHealthStore() : undefined;
	cooldowns = COOLDOWNS_ENABLED ? inMemoryCooldowns : undefined;
} else {
	health = HEALTH_ENABLED ? new ValkeyHealthStore({ redis }) : undefined;
	cooldowns = COOLDOWNS_ENABLED ? new ValkeyCooldownStore({ redis }) : undefined;
}

// The probe is what lifts a demoted provider, and without it health is a one-way door.
// Only started when health is on: with health off nothing is ever demoted, so a prober would
// be a timer that wakes up to find nothing to do.
const prober =
	health === undefined
		? undefined
		: new Prober({
				health,
				transport,
				candidates,
				// A lease only matters when several replicas share state. With in-process state
				// there is nobody to race, and requiring one would mean requiring Valkey.
				...(redis === undefined
					? {}
					: {
							lease: async (key: string, ttlMs: number) => {
								const got = await redis.set(`lock:${key}`, HOSTNAME, 'PX', ttlMs, 'NX');
								return got === 'OK';
							},
						}),
			});
prober?.start();

/** One NDJSON line per /v1 request, to stdout. `PROXLANE_LOG=off` to silence it. */
const LOG = createLogger(env);

const app = createApp({
	transport,
	candidates,
	apiKey,
	maxBodyBytes: MAX_BODY_BYTES,
	maxInflight: MAX_INFLIGHT,
	defaultDeadlineMs: DEFAULT_DEADLINE_MS,
	orgId: ORG_ID,
	...(LOG === undefined ? {} : { log: LOG }),
	logUrls: (env('PROXLANE_LOG_URLS') ?? 'off') === 'on',
	terminalRetries: TERMINAL_RETRIES,
	...(health === undefined ? {} : { health }),
	...(cooldowns === undefined ? {} : { cooldowns }),
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
	process.stdout.write(
		`\n  proxlane gateway ${VERSION} on :${info.port}\n` +
			`  providers: ${candidates.map((c) => c.adapter.capabilities.id).join(' > ')} (in order)\n` +
			`  state:     ${redis === undefined ? 'in-process (single replica only)' : 'valkey (shared)'}\n` +
			`  health:    ${HEALTH_ENABLED ? 'on — GET /health/providers' : 'off by default; PROXLANE_HEALTH=on to enable'}\n` +
			`  cooldowns: ${COOLDOWNS_ENABLED ? 'on — GET /health/cooldowns' : 'OFF (PROXLANE_COOLDOWNS=off)'}\n` +
			`  inflight:  ${MAX_INFLIGHT} concurrent, then 429 GATEWAY_BUSY (PROXLANE_MAX_INFLIGHT)\n` +
			`  retries:   ${TERMINAL_RETRIES === 0 ? 'none — failover only' : `${TERMINAL_RETRIES} extra at the last provider`} (PROXLANE_TERMINAL_RETRIES)\n` +
			`  log:       ${LOG === undefined ? 'OFF (PROXLANE_LOG=off) — nothing is recorded' : 'one line per request to stdout'}\n` +
			`  memory:    ${MEMORY_NOTE}\n` +
			`  prober:    ${prober === undefined ? 'off (needs health)' : 'on — demoted providers are probed back'}\n` +
			`  GET /v1?api_key=…&url=https://example.com\n\n`,
	);
});

/**
 * Shut down without losing work or cutting a scrape in half.
 *
 * There was no signal handling at all. Node's default SIGTERM handler hard-exits, so a
 * container stop dropped every buffered health observation, abandoned in-flight scrapes
 * mid-request — up to the 90s deadline — and left the Valkey socket open. `close()` existed
 * on the health store and was called from nowhere but tests, which made its own comment
 * ("close() flushes on a clean one") false.
 *
 * Idempotent, because SIGINT following SIGTERM is normal, and bounded: a shutdown that hangs
 * waiting for a dead Valkey is worse than one that loses a flush interval, and the
 * orchestrator's SIGKILL is not a graceful path.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	process.stdout.write(`\n  ${signal} — draining\n`);

	// Every step is independent and none may abort the rest. Found by driving it: stopping
	// Valkey and then sending SIGTERM crashed the process with an unhandled rejection out of
	// `redis.quit()` — "Stream isn't writeable" — because `enableOfflineQueue: false` makes
	// QUIT reject rather than resolve on a broken connection. A shutdown that throws when the
	// dependency is down is the exact opposite of what a graceful shutdown is for, and it is
	// the case most likely to be happening when someone restarts the container.
	const step = async (what: string, fn: () => Promise<unknown>): Promise<void> => {
		try {
			await fn();
		} catch (err) {
			process.stderr.write(
				`  ${what} failed during shutdown: ${err instanceof Error ? err.message : String(err)}\n`,
			);
		}
	};

	const deadline = new Promise<void>((r) => setTimeout(r, 10_000).unref());
	await Promise.race([
		(async () => {
			await step('closing the server', () => new Promise<void>((r) => server.close(() => r())));
			if (health instanceof ValkeyHealthStore)
				await step('draining health', () => health.close());
			if (redis !== undefined) {
				// QUIT is the polite close and needs a live socket. `disconnect()` always works and
				// is what actually releases the handle, so it runs either way.
				await step('closing valkey', () => redis.quit());
				redis.disconnect();
			}
		})(),
		deadline,
	]);
	process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.on(signal, () => void shutdown(signal));
}
