// The server. Wiring only: what to run, with which keys, on which port.
//
// Every decision lives elsewhere — the chain decides routing, FAILOVER decides retries,
// the adapters decide translation. This file exists so that `pnpm dev` runs the real thing.

import { serve } from '@hono/node-server';
import { type Adapter, REGISTRY } from '@proxlane/adapters';
import { createApp } from './app.js';
import { assertSingleWriter, InMemoryHealthStore } from './health-store.js';
import { createFetchTransport } from './transport.js';

const PORT = Number(process.env.PORT ?? 8787);
const DEFAULT_DEADLINE_MS = Number(process.env.PROXLANE_DEADLINE_MS ?? 90_000);
const MAX_BODY_BYTES = Number(process.env.PROXLANE_BODY_CAP_MB ?? 10) * 1024 * 1024;

// Health tracking is ON by default and opts OUT, not in.
//
// A demoted provider that can never recover is a far worse default than a gateway that keeps
// a running opinion of its providers, and the whole point of the statistic is that it needs
// no configuration to be useful. The switch exists for someone who wants the chain to behave
// exactly as it did before, and for bisecting a routing complaint.
const HEALTH_ENABLED = (process.env.PROXLANE_HEALTH ?? 'on') !== 'off';

// Provider health is stored in this process, so a second replica would keep a second opinion
// and demote independently. Refuse rather than misroute. See health-store.ts.
assertSingleWriter(Number(process.env.PROXLANE_REPLICAS ?? 1));

const apiKey = process.env.PROXLANE_API_KEY;
if (apiKey === undefined || apiKey === '') {
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

const app = createApp({
	transport: createFetchTransport(),
	candidates,
	apiKey,
	maxBodyBytes: MAX_BODY_BYTES,
	defaultDeadlineMs: DEFAULT_DEADLINE_MS,
	...(HEALTH_ENABLED ? { health: new InMemoryHealthStore() } : {}),
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
	process.stdout.write(
		`\n  proxlane gateway on :${info.port}\n` +
			`  providers: ${candidates.map((c) => c.adapter.capabilities.id).join(', ')}\n` +
			`  health:    ${HEALTH_ENABLED ? 'on, in-process — GET /health/providers' : 'OFF (PROXLANE_HEALTH=off)'}\n` +
			`  GET /v1?api_key=…&url=https://example.com\n\n`,
	);
});
