import { type Adapter, type GatewayRequest, policyFor, REGISTRY } from '@proxlane/adapters';
import { EXIT, emit, emitError, style } from './output.js';

// `proxlane scrape <url> --provider=<id>` — one real attempt through one real adapter.
//
// SCOPE, STATED PLAINLY BECAUSE THE PRODUCT'S HEADLINE IS FAILOVER: this runs a SINGLE
// provider. There is no chain, no cooldown and no detection here, because routing lives in
// the gateway and a second implementation in the CLI would drift from it the first time
// either changed. --provider is therefore required rather than defaulted: a default would
// imply a choice was made on your behalf, and no chooser exists yet.
//
// What it is genuinely good for today is the question an agent actually asks mid-incident:
// "does THIS provider get THIS url, and what does proxlane call the result?"

interface ScrapeOptions {
	readonly url: string;
	readonly provider: string;
	readonly renderJs: boolean;
	readonly premium: 'none' | 'residential' | 'stealth';
	readonly countryCode?: string;
	readonly timeoutMs?: number;
	readonly showBody: boolean;
}

export async function scrape(o: ScrapeOptions, json: boolean): Promise<number> {
	const load = REGISTRY[o.provider.replace(/-/g, '_')] as (() => Promise<Adapter>) | undefined;
	if (!load) {
		emitError(
			'scrape',
			'UNKNOWN_PROVIDER',
			`"${o.provider}" is not a registered provider. Known: ${Object.keys(REGISTRY).sort().join(', ')}`,
			json,
		);
		return EXIT.USAGE;
	}
	const adapter = await load();

	const envVar = `${adapter.capabilities.id.toUpperCase().replace(/-/g, '_')}_KEY`;
	const key = process.env[envVar];
	if (key === undefined || key === '') {
		// CONFIG, not USAGE: the call was right and the environment is wrong. An agent should
		// stop and fix setup rather than retry with different arguments.
		emitError(
			'scrape',
			'MISSING_KEY',
			`${envVar} is not set. This is BYOK — export your own provider key.`,
			json,
		);
		return EXIT.CONFIG;
	}

	const req: GatewayRequest = {
		url: o.url,
		method: 'GET',
		renderJs: o.renderJs,
		premium: o.premium,
		deadlineMs: o.timeoutMs ?? adapter.capabilities.maxTimeoutMs,
		...(o.countryCode === undefined ? {} : { countryCode: o.countryCode }),
	};

	let wire: ReturnType<Adapter['translate']>;
	try {
		wire = adapter.translate(req, key);
	} catch (err) {
		// translate() refuses rather than silently sending something else — e.g. POST on an
		// adapter that declares post:false. That refusal is a capability answer, not a crash.
		emitError('scrape', 'UNSUPPORTED', err instanceof Error ? err.message : String(err), json);
		return EXIT.USAGE;
	}

	const budget = o.timeoutMs ?? wire.timeoutMs;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), budget);
	const started = Date.now();
	try {
		const res = await fetch(wire.url, {
			method: wire.method,
			headers: wire.headers,
			...(wire.body === undefined ? {} : { body: wire.body }),
			signal: controller.signal,
		});
		const bytes = new Uint8Array(await res.arrayBuffer());
		const headers: Record<string, string> = {};
		res.headers.forEach((v, k) => {
			headers[k] = v;
		});
		const latencyMs = Date.now() - started;

		const result = adapter.parse({ status: res.status, headers, body: bytes });
		const policy = policyFor(result.outcome);
		const data = {
			url: o.url,
			provider: adapter.capabilities.id,
			outcome: result.outcome,
			upstreamStatusCode: result.upstreamStatusCode,
			httpStatus: policy.httpStatus,
			failover: policy.failover,
			chargeable: policy.chargeable,
			pages: policy.pages,
			meaning: policy.meaning,
			latencyMs,
			bodyBytes: result.body?.byteLength ?? 0,
			contentType: result.contentType,
			charset: result.charset,
			cost: result.cost,
			...(o.showBody && result.body !== undefined
				? { body: new TextDecoder().decode(result.body) }
				: {}),
		};

		emit({ ok: result.outcome === 'OK', command: 'scrape', data }, json, () => {
			const mark =
				result.outcome === 'OK' ? style('OK', 'green') : style(result.outcome, 'yellow');
			return (
				`\n  ${mark}  ${o.url}\n` +
				`  ${style(`via ${data.provider} · ${latencyMs}ms · ${data.bodyBytes} bytes · upstream ${data.upstreamStatusCode ?? 'n/a'}`, 'dim')}\n` +
				`  ${style(`${policy.meaning}. failover ${String(policy.failover)}, charged ${String(policy.chargeable)}`, 'dim')}\n` +
				(o.showBody && result.body !== undefined
					? `\n${new TextDecoder().decode(result.body)}\n`
					: '') +
				'\n'
			);
		});
		// Exit 1 on any non-OK outcome. The command SUCCEEDED at answering; the answer is bad,
		// and an agent branching on the exit code wants that distinction, not a crash.
		return result.outcome === 'OK' ? EXIT.OK : EXIT.FAILED;
	} catch (err) {
		// Discriminated on the signal, never the message: Node reports an abort as "This
		// operation was aborted", so message-matching happens to work until a DNS error
		// containing the word arrives and gets labelled a timeout.
		const timedOut = controller.signal.aborted;
		emitError(
			'scrape',
			timedOut ? 'PROVIDER_TIMEOUT' : 'TRANSPORT_ERROR',
			timedOut
				? `no response within ${budget}ms`
				: `transport failed: ${err instanceof Error ? err.message : String(err)}`,
			json,
		);
		return EXIT.FAILED;
	} finally {
		// In `finally`, not chained to fetch(): fetch() resolves on HEADERS, so clearing it
		// there leaves the body read with no deadline at all.
		clearTimeout(timer);
	}
}
