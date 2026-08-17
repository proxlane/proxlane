import { readFileSync } from 'node:fs';
import { REGISTRY } from '@proxlane/adapters';
import { assessMemory, describeSource, readMemoryLimit } from '@proxlane/shared';
import { EXIT, emit, style } from './output.js';

// `proxlane doctor` — the self-host support surface.
//
// operating.md B9 makes this the thing that answers a support question before a human does,
// and sets the bar: every check PRINTS WHAT IT CHECKED, not just pass or fail. "Postgres:
// ok" is useless in an issue thread; "Postgres 17.2 at db:5432, 4ms" answers the follow-up
// before it is asked. Every support question that takes more than one exchange should
// become a new check here.
//
// Checks are honest about scope: this diagnoses the LOCAL environment and configuration.
// A check that reports "ok" for a component that does not exist is the zero-exit stub in
// another costume.
//
// The routing-state checks below arrived late, and two operator reviews had to ask for them.
// The rule this file states — every support question that takes more than one exchange
// becomes a check — was not followed when health, cooldowns and Valkey shipped, and the very
// first support question they produced ("why is /health/providers 500ing") was one this
// command could not answer. Adding a subsystem means adding its checks in the same PR.

export interface Check {
	readonly name: string;
	readonly ok: boolean;
	/** What was actually observed. Never just "ok". */
	readonly detail: string;
	/** Present when ok is false: what to do about it. */
	readonly fix?: string;
}

function nodeCheck(): Check {
	const major = Number(process.versions.node.split('.')[0]);
	const ok = major >= 24;
	return {
		name: 'node',
		ok,
		detail: `${process.version} (${process.platform}/${process.arch})`,
		...(ok
			? {}
			: { fix: 'proxlane needs Node 24 or newer; 22 entered maintenance in 2025-10' }),
	};
}

async function providerKeyChecks(): Promise<Check[]> {
	const ids = Object.keys(REGISTRY).sort();
	return ids.map((id) => {
		const envVar = `${id.toUpperCase().replace(/-/g, '_')}_KEY`;
		const v = process.env[envVar];
		const present = v !== undefined && v !== '';
		return {
			name: `key:${id}`,
			// NOT a failure. BYOK means you bring the providers you use, and nobody is expected
			// to hold all three. Reporting a missing key as broken would train people to ignore
			// the output, which is how a diagnostic stops being read.
			ok: true,
			// Length only, never a prefix or suffix. Redaction happens at the VALUE, before it
			// reaches any renderer, or the --json path leaks what the human path hides.
			detail: present ? `$${envVar} set (${v.length} chars)` : `$${envVar} not set`,
		};
	});
}

function egressCheck(): Check {
	const proxy =
		process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? undefined;
	return {
		name: 'egress',
		ok: true,
		detail:
			proxy === undefined
				? 'no proxy env set; requests go direct'
				: `proxy env set (${proxy.replace(/\/\/.*@/, '//REDACTED@')})`,
	};
}

/** Empty string means unset, exactly as the gateway reads it. See apps/gateway/src/index.ts. */
/** Absent, unreadable and empty are the same answer here: no limit we can trust. */
function readIfPresent(path: string): string | undefined {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return undefined;
	}
}

function env(name: string): string | undefined {
	const v = process.env[name];
	return v === undefined || v.trim() === '' ? undefined : v;
}

/**
 * Routing state: where it lives, and whether that agrees with how many gateways will run.
 *
 * This is the check that would have caught the shipped-broken default. `docker compose`
 * interpolates `${PROXLANE_VALKEY_URL:-}` to an EMPTY STRING rather than leaving it unset, so
 * a gateway reading `!== undefined` built a Redis client for `''` and spent its life logging
 * ECONNREFUSED. Reporting the value as the gateway interprets it makes that visible in one
 * line instead of one support thread.
 */
function stateChecks(): Check[] {
	const url = env('PROXLANE_VALKEY_URL');
	const raw = process.env.PROXLANE_VALKEY_URL;
	const replicas = env('PROXLANE_REPLICAS') ?? '1';
	const n = Number(replicas);
	const out: Check[] = [];

	out.push({
		name: 'state store',
		ok: true,
		detail:
			url === undefined
				? `in-process${raw === '' ? ' (PROXLANE_VALKEY_URL is set but empty, which reads as unset)' : ''}` +
					' (correct for one gateway, lost on restart)'
				: `valkey at ${redactUrl(url)}, shared and surviving restart`,
	});

	const replicasOk = Number.isFinite(n) && n >= 1 && (n === 1 || url !== undefined);
	out.push({
		name: 'replicas',
		ok: replicasOk,
		detail: `PROXLANE_REPLICAS=${replicas}, state is ${url === undefined ? 'in-process' : 'shared'}`,
		...(replicasOk
			? {}
			: {
					fix: !Number.isFinite(n)
						? `PROXLANE_REPLICAS must be a positive number; the gateway refuses to boot on "${replicas}"`
						: 'more than one replica needs PROXLANE_VALKEY_URL, or each keeps its own ' +
							'cooldowns and routes to a provider another was just refused by',
				}),
	});
	return out;
}

/** Never print credentials from a connection string. */
function redactUrl(url: string): string {
	return url.replace(/\/\/[^@/]*@/, '//REDACTED@');
}

/**
 * Which routing features are on, and what that means.
 *
 * Health defaults OFF and cooldowns ON, which is not guessable and is the second support
 * question these subsystems produce: "I set PROXLANE_HEALTH and nothing happened" — usually
 * because it was set in `.env` for a compose file that did not pass it through.
 */
function routingChecks(): Check[] {
	const health = (env('PROXLANE_HEALTH') ?? 'off') === 'on';
	const cooldowns = (env('PROXLANE_COOLDOWNS') ?? 'on') !== 'off';
	return [
		{
			name: 'provider health',
			ok: true,
			detail: health
				? 'on. The chain re-ranks by health; read GET /health/providers'
				: 'off (the default). Set PROXLANE_HEALTH=on to enable, then read GET /health/providers',
		},
		{
			name: 'cooldowns',
			ok: true,
			detail: cooldowns
				? 'on. A provider that just refused a domain is skipped, with Retry-After when all are'
				: 'OFF (PROXLANE_COOLDOWNS=off). Every request retries providers that just refused it',
		},
		backpressureCheck(),
		terminalRetryCheck(),
	];
}

/**
 * The extra go at the last provider, and — more usefully — whether there IS a last provider.
 *
 * B9-shaped in both directions. "Why does one request show two attempts and two charges?" is
 * answered by naming the setting and the two outcomes that trigger it. The harder question is
 * the one an operator does not know to ask: with a single key configured, every request's
 * first hop is also its terminal hop, so there is no failover at all and this retry is the
 * only thing standing between a transient provider error and a failed scrape. Counting the
 * keys is what turns that from documentation into a diagnostic.
 */
function terminalRetryCheck(): Check {
	const raw = env('PROXLANE_TERMINAL_RETRIES');
	const n = Number(raw ?? 1);
	const valid = Number.isInteger(n) && n >= 0 && n <= 10;
	if (!valid) {
		return {
			name: 'terminal retry',
			ok: false,
			detail: `PROXLANE_TERMINAL_RETRIES=${raw ?? '(unset)'}, which is not a whole number from 0 to 10`,
			fix: 'set it between 0 and 10, or unset it for the default of 1. The gateway refuses to boot on anything else',
		};
	}
	const keyed = Object.keys(REGISTRY).filter((id) => {
		const v = process.env[`${id.toUpperCase().replace(/-/g, '_')}_KEY`];
		return v !== undefined && v !== '';
	}).length;
	const what =
		n === 0
			? 'off. A provider that fails at the end of the chain ends the request'
			: `${n} extra ${n === 1 ? 'go' : 'goes'} at the LAST provider, on PROVIDER_ERROR and PROVIDER_TIMEOUT only. ` +
				'Each one is a real request and appears in X-Attempts and X-Cost-Estimate';
	const chain =
		keyed === 0
			? 'no provider keys are set, so nothing routes at all'
			: keyed === 1
				? 'ONE provider key is set, so there is no failover — the first hop is the terminal hop on every request'
				: `${keyed} provider keys are set, so a failure moves to the next provider before this applies`;
	return {
		name: 'terminal retry',
		ok: true,
		detail: `${what}. ${chain}`,
		...(keyed === 1 && n === 0
			? {
					fix: 'with one provider and no retry, a single transient provider error fails the request. Add a second provider key, or unset PROXLANE_TERMINAL_RETRIES for the default of 1',
				}
			: {}),
	};
}

/**
 * The in-flight ceiling, and the arithmetic nobody does until the container is OOM-killed.
 *
 * Two support questions in one, and both are B9-shaped — more than one exchange to answer
 * from the outside. "Why am I getting 429s when the providers are fine?" is answered by the
 * ceiling and the fact that `GATEWAY_BUSY` is class `gateway`, not `provider`. "Why does the
 * container keep restarting?" is answered by the memory line: the gateway buffers every body
 * before the detector reads it, so the working set is roughly `maxInflight * bodyCap * 2.5`,
 * and there is no boot-time check enforcing it yet.
 *
 * Prints the numbers rather than a verdict, per B9: `backpressure: ok` in an issue thread
 * tells a maintainer nothing.
 */
function backpressureCheck(): Check {
	const raw = env('PROXLANE_MAX_INFLIGHT');
	const max = Number(raw ?? 32);
	const capMb = Number(env('PROXLANE_BODY_CAP_MB') ?? 10);
	// The same rule `InflightLimiter` enforces, so `doctor` predicts the boot rather than
	// disagreeing with it.
	const ok = Number.isInteger(max) && max >= 1;
	if (!ok) {
		return {
			name: 'backpressure',
			ok: false,
			detail: `PROXLANE_MAX_INFLIGHT=${raw ?? '(unset)'}, which is not a positive integer`,
			fix: 'set it to a positive whole number, or unset it for the default of 32. The gateway refuses to boot on anything else',
		};
	}
	// The SAME function the gateway boots against, so doctor cannot report a budget the
	// gateway disagrees with. That divergence is the classic diagnostic-tool bug: it says
	// everything is fine while the thing it diagnoses refuses to start.
	const budget = assessMemory(max, capMb, readMemoryLimit(readIfPresent, env));
	const sizing =
		budget.verdict === 'unknown'
			? `wants ~${budget.needMb} MB; no container limit is readable, so the gateway skips the check`
			: `wants ~${budget.needMb} MB of ${budget.limit.limitMb} MB from ${describeSource(budget.limit.source)}`;
	return {
		name: 'backpressure',
		// `over` is what the gateway refuses to boot on, so doctor reports it as a failure and
		// says the same thing rather than a cheerful summary of a broken configuration.
		ok: budget.verdict !== 'over',
		detail:
			`${max} concurrent /v1 requests, then 429 GATEWAY_BUSY with Retry-After. ` +
			`Sheds rather than queues; /health is never shed. At a ${capMb} MB body cap it ${sizing}`,
		...(budget.verdict === 'over'
			? {
					fix: `the gateway will refuse to boot. Lower PROXLANE_MAX_INFLIGHT to about ${Math.max(1, Math.floor((budget.limit.limitMb ?? 0) / (capMb * 2.5)))}, or give the container more memory`,
				}
			: {}),
	};
}

/**
 * Can we actually reach the state store we are configured to use?
 *
 * A TCP connect rather than a Redis handshake: `ioredis` is not a CLI dependency and should
 * not become one for a diagnostic. Reaching the port is what distinguishes "misconfigured" —
 * the case that shipped — from "Valkey is unwell", and that is the distinction an operator
 * needs before they can act.
 */
async function valkeyReachable(): Promise<Check | undefined> {
	const url = env('PROXLANE_VALKEY_URL');
	if (url === undefined) return undefined;
	let host: string;
	let port: number;
	try {
		const u = new URL(url);
		host = u.hostname;
		port = Number(u.port === '' ? 6379 : u.port);
	} catch {
		return {
			name: 'valkey reachable',
			ok: false,
			detail: `PROXLANE_VALKEY_URL is not a URL: ${redactUrl(url)}`,
			fix: 'expected something like redis://valkey:6379',
		};
	}
	const started = Date.now();
	const { createConnection } = await import('node:net');
	const reached = await new Promise<string | null>((resolve) => {
		const socket = createConnection({ host, port });
		const done = (err: string | null) => {
			socket.destroy();
			resolve(err);
		};
		socket.setTimeout(2000, () => done('timed out after 2s'));
		socket.once('connect', () => done(null));
		socket.once('error', (e: Error) => done(e.message));
	});
	return {
		name: 'valkey reachable',
		ok: reached === null,
		detail:
			reached === null
				? `${host}:${port} accepted a connection in ${Date.now() - started}ms`
				: `${host}:${port}, ${reached}`,
		...(reached === null
			? {}
			: {
					fix:
						'the gateway fails OPEN, so it will still serve, but health and cooldowns are ' +
						'lost. Check the service is up and the URL is reachable from this host.',
				}),
	};
}

export async function doctor(json: boolean): Promise<number> {
	const checks: Check[] = [
		nodeCheck(),
		...(await providerKeyChecks()),
		egressCheck(),
		...stateChecks(),
		...routingChecks(),
	];
	const reach = await valkeyReachable();
	if (reach !== undefined) checks.push(reach);
	if (checks.length === 0) {
		process.stderr.write('doctor ran zero checks. That is a bug, not a clean bill of health\n');
		return EXIT.FAILED;
	}
	const failed = checks.filter((c) => !c.ok);

	emit(
		{ ok: failed.length === 0, command: 'doctor', data: { checks, failed: failed.length } },
		json,
		() => {
			const rows = checks.map((c) => {
				const mark = c.ok ? style('ok  ', 'green') : style('FAIL', 'red');
				return (
					`  ${mark} ${c.name.padEnd(18)} ${c.detail}\n` +
					(c.fix === undefined ? '' : `       ${style(c.fix, 'yellow')}\n`)
				);
			});
			return `\n${rows.join('')}\n  ${style(
				failed.length === 0
					? `${checks.length} checks, all good. Paste with --json when opening an issue.`
					: `${failed.length} of ${checks.length} checks failed.`,
				'dim',
			)}\n\n`;
		},
	);
	return failed.length === 0 ? EXIT.OK : EXIT.FAILED;
}
