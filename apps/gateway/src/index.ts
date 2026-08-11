// The server. Wiring only: what to run, with which keys, on which port.
//
// Every decision lives elsewhere — the chain decides routing, FAILOVER decides retries,
// the adapters decide translation. This file exists so that `pnpm dev` runs the real thing.

import { serve } from '@hono/node-server';
import { type Adapter, REGISTRY } from '@proxlane/adapters';
import { Redis } from 'ioredis';
import { createApp } from './app.js';
import { type CooldownStore, InMemoryCooldownStore } from './cooldown-store.js';
import { assertSingleWriter, type HealthStore, InMemoryHealthStore } from './health-store.js';
import { createFetchTransport } from './transport.js';
import { ValkeyCooldownStore, ValkeyHealthStore } from './valkey.js';

const PORT = Number(process.env.PORT ?? 8787);
const DEFAULT_DEADLINE_MS = Number(env('PROXLANE_DEADLINE_MS') ?? 90_000);
// Empty would read as 0 here, i.e. a body cap of nothing, which rejects every response.
const MAX_BODY_BYTES = Number(env('PROXLANE_BODY_CAP_MB') ?? 10) * 1024 * 1024;

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
// its time demoted, against 0.8% for the iid stream every published specificity figure was
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
const candidates: { adapter: Adapter; key: string }[] = [];
for (const id of Object.keys(REGISTRY).sort()) {
	const adapter = await (REGISTRY[id] as () => Promise<Adapter>)();
	const envVar = `${id.toUpperCase().replace(/-/g, '_')}_KEY`;
	const key = process.env[envVar];
	if (key === undefined || key === '') continue;
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

const app = createApp({
	transport: createFetchTransport(),
	candidates,
	apiKey,
	maxBodyBytes: MAX_BODY_BYTES,
	defaultDeadlineMs: DEFAULT_DEADLINE_MS,
	orgId: ORG_ID,
	...(health === undefined ? {} : { health }),
	...(cooldowns === undefined ? {} : { cooldowns }),
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
	process.stdout.write(
		`\n  proxlane gateway on :${info.port}\n` +
			`  providers: ${candidates.map((c) => c.adapter.capabilities.id).join(', ')}\n` +
			`  state:     ${redis === undefined ? 'in-process (single replica only)' : 'valkey (shared)'}\n` +
			`  health:    ${HEALTH_ENABLED ? 'on — GET /health/providers' : 'off by default; PROXLANE_HEALTH=on to enable'}\n` +
			`  cooldowns: ${COOLDOWNS_ENABLED ? 'on' : 'OFF (PROXLANE_COOLDOWNS=off)'}\n` +
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

	const deadline = new Promise<void>((r) => setTimeout(r, 10_000).unref());
	await Promise.race([
		(async () => {
			await new Promise<void>((r) => server.close(() => r()));
			if (health instanceof ValkeyHealthStore) await health.close();
			if (redis !== undefined) await redis.quit();
		})(),
		deadline,
	]);
	process.exit(0);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.on(signal, () => void shutdown(signal));
}
