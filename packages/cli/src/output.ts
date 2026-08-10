// Every command renders through here, and every command supports --json.
//
// The design constraint is that the primary consumer is a PROGRAM, not a person: an agent
// shelling out, or a support script. That leads to four rules, each of which is a thing
// that breaks machine consumption when it is missing.
//
//   1. --json is not a nicety. Pretty output is for the human running it once; JSON is what
//      gets parsed, diffed, and pasted into an issue. Retrofitting structure onto
//      pretty-printed text never happens, so both exist from the first command.
//   2. stdout carries DATA, stderr carries commentary. A caller doing `proxlane x --json |
//      jq` must never receive a progress line on stdout.
//   3. No colour unless a human is looking. Non-TTY or NO_COLOR means plain, because ANSI
//      escapes pasted into a GitHub issue are worse than no colour at all.
//   4. No spinners, no prompts, ever. A spinner writes thousands of bytes of escape codes
//      into a captured log, and a prompt hangs a process that has nobody to answer it.

export interface Envelope<T> {
	readonly ok: boolean;
	readonly command: string;
	readonly data?: T;
	readonly error?: { readonly code: string; readonly message: string };
}

/**
 * Colour is off unless stdout is a TTY and nobody asked otherwise.
 *
 * `NO_COLOR` is honoured by presence, per no-color.org — the spec is that ANY value,
 * including the empty string, disables colour. Checking truthiness instead would leave
 * `NO_COLOR=` colourised, which is the one case a user setting it bare expects to work.
 */
export function colorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.NO_COLOR !== undefined) return false;
	if (env.FORCE_COLOR !== undefined) return true;
	return process.stdout.isTTY === true;
}

const CODES = { dim: '2', red: '31', green: '32', yellow: '33', bold: '1' } as const;
export type Style = keyof typeof CODES;

export function style(s: string, name: Style, enabled = colorEnabled()): string {
	return enabled ? `[${CODES[name]}m${s}[0m` : s;
}

/** Exit codes are public API: an agent branches on them. Changing one is a breaking change. */
export const EXIT = {
	/** The command ran and the answer is good. */
	OK: 0,
	/** The command ran and the answer is bad — unhealthy, blocked, not OK. NOT an error. */
	FAILED: 1,
	/** The invocation was wrong: unknown command, missing or bad argument. */
	USAGE: 2,
	/** The environment is wrong: no API key, unreadable config. Fix the setup, not the call. */
	CONFIG: 3,
} as const;

export function emit<T>(env: Envelope<T>, json: boolean, human: () => string): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(env, null, 2)}\n`);
		return;
	}
	process.stdout.write(human());
}

/** Structured on stderr when --json, so a failure is still parseable. */
export function emitError(command: string, code: string, message: string, json: boolean): void {
	if (json) {
		const env: Envelope<never> = { ok: false, command, error: { code, message } };
		process.stderr.write(`${JSON.stringify(env, null, 2)}\n`);
		return;
	}
	process.stderr.write(`${style('error', 'red')}  ${message}\n`);
}
