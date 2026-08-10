import { REGISTRY } from '@proxlane/adapters';
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
// Database and cache checks arrive with the gateway that uses them — a check that reports
// "ok" for a component that does not exist yet is the zero-exit stub in another costume.

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

export async function doctor(json: boolean): Promise<number> {
	const checks: Check[] = [nodeCheck(), ...(await providerKeyChecks()), egressCheck()];
	if (checks.length === 0) {
		process.stderr.write(
			'doctor ran zero checks — that is a bug, not a clean bill of health\n',
		);
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
