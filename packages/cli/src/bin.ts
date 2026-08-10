#!/usr/bin/env node
// The unscoped `proxlane` package. The SDK is @proxlane/sdk — the bin and the name must
// live together, or `npx proxlane doctor` fetches a package that declares no bin.
//
// Non-interactive by design. There are no prompts and no spinners anywhere in this CLI:
// a prompt hangs a process with nobody to answer it, and a spinner writes thousands of
// escape codes into a captured log. Both are hostile to the primary caller, which is a
// program.

import { createRequire } from 'node:module';
import { doctor } from './doctor.js';
import { OUTCOME_COUNT, outcomes } from './outcomes.js';
import { EXIT, emitError } from './output.js';
import { providers } from './providers.js';
import { scrape } from './scrape.js';

// Read from package.json, never hardcoded. A literal here reported 0.0.0 from a package
// published as 0.0.1 — the CLI lying about its own version, in the first field anyone
// checks when filing a bug. It would have drifted again on every single release.
//
// createRequire because this bundles to ESM, where import.meta.resolve on a JSON file is
// not the simple path it looks like. `../package.json` from dist/ is the package root.
const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string })
	.version;

const HELP = `proxlane ${VERSION} — one endpoint in front of every scraping API

Usage
  proxlane <command> [options]

Commands
  scrape <url>      fetch a url through one provider and name the outcome
  providers         what each adapter can do, from the registry
  outcomes [name]   the ${OUTCOME_COUNT}-outcome taxonomy: failover, billing, http status
  doctor            diagnose this environment; paste the --json into an issue

Global options
  --json            machine-readable output on stdout. Supported by every command.
  --help, -h        this text
  --version, -v     version only, no decoration

scrape options
  --provider=<id>   REQUIRED. There is no routing yet, so nothing can choose for you.
  --render-js       run the page's JavaScript before returning it
  --premium=<tier>  none | residential | stealth        (default none)
  --country=<cc>    ISO 3166-1 alpha-2, lowercased for you
  --timeout=<ms>    per-attempt budget; defaults to the provider's own ceiling
  --body            print the page body as well as the verdict

Exit codes, which are public API
  0  the answer is good
  1  the command ran and the answer is bad — unhealthy, blocked, not OK
  2  the invocation was wrong: unknown command, missing or bad argument
  3  the environment is wrong: no API key. Fix the setup, not the call.

Environment
  <PROVIDER>_KEY    e.g. SCRAPERAPI_KEY. BYOK: proxlane never holds a key for you.
  NO_COLOR          any value, including empty, disables colour
  FORCE_COLOR       colour even when stdout is not a terminal

Notes for agents
  Every command supports --json and emits {ok, command, data} on stdout, or
  {ok:false, command, error:{code, message}} on stderr. Branch on the exit code,
  read the outcome from data.outcome, and run \`proxlane outcomes --json\` once to
  learn what each outcome means for retrying and billing.
`;

function flag(argv: string[], name: string): boolean {
	return argv.includes(`--${name}`);
}
function value(argv: string[], name: string): string | undefined {
	const hit = argv.find((a) => a.startsWith(`--${name}=`));
	return hit?.slice(name.length + 3);
}

const argv = process.argv.slice(2);
const json = flag(argv, 'json');
const cmd = argv[0];

if (cmd === undefined || cmd === '--help' || cmd === '-h') {
	process.stdout.write(HELP);
	process.exit(EXIT.OK);
}
if (cmd === '--version' || cmd === '-v') {
	process.stdout.write(`${VERSION}\n`);
	process.exit(EXIT.OK);
}

// Read a local .env.local if there is one, so BYOK keys do not have to live in shell
// history. Never overrides an already-set variable, so an explicit `KEY=… proxlane …` and
// CI secrets both still win.
try {
	process.loadEnvFile('.env.local');
} catch {
	// Absent is the normal case.
}

let code: number = EXIT.USAGE;
switch (cmd) {
	case 'doctor':
		code = await doctor(json);
		break;
	case 'providers':
		code = await providers(json);
		break;
	case 'outcomes':
		code = outcomes(argv.slice(1), json);
		break;
	case 'scrape': {
		const url = argv[1];
		if (url === undefined || url.startsWith('-')) {
			emitError('scrape', 'MISSING_URL', 'usage: proxlane scrape <url> --provider=<id>', json);
			code = EXIT.USAGE;
			break;
		}
		const provider = value(argv, 'provider');
		if (provider === undefined) {
			emitError(
				'scrape',
				'MISSING_PROVIDER',
				'--provider=<id> is required; run `proxlane providers` to list them',
				json,
			);
			code = EXIT.USAGE;
			break;
		}
		const premium = value(argv, 'premium') ?? 'none';
		if (premium !== 'none' && premium !== 'residential' && premium !== 'stealth') {
			emitError('scrape', 'BAD_PREMIUM', `--premium must be none|residential|stealth`, json);
			code = EXIT.USAGE;
			break;
		}
		const timeoutRaw = value(argv, 'timeout');
		const timeoutMs = timeoutRaw === undefined ? undefined : Number(timeoutRaw);
		if (timeoutMs !== undefined && !Number.isFinite(timeoutMs)) {
			emitError('scrape', 'BAD_TIMEOUT', `--timeout must be a number of milliseconds`, json);
			code = EXIT.USAGE;
			break;
		}
		// Hoisted: calling value() twice inside the spread gives TypeScript two independent
		// `string | undefined`s to reason about, and exactOptionalPropertyTypes then refuses
		// the one it cannot prove is defined.
		const countryCode = value(argv, 'country');
		code = await scrape(
			{
				url,
				provider,
				renderJs: flag(argv, 'render-js'),
				premium,
				showBody: flag(argv, 'body'),
				...(countryCode === undefined ? {} : { countryCode }),
				...(timeoutMs === undefined ? {} : { timeoutMs }),
			},
			json,
		);
		break;
	}
	default:
		emitError('proxlane', 'UNKNOWN_COMMAND', `unknown command "${cmd}"`, json);
		if (!json) process.stderr.write(`\n${HELP}`);
		code = EXIT.USAGE;
}

process.exit(code);
