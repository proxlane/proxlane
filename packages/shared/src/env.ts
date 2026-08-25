// Reading configuration out of the environment, where the shape of a value matters more
// than it looks like it should.

/**
 * A provider key from the environment, or `undefined`.
 *
 * TRIMMED, and that is the whole reason this exists rather than each caller writing
 * `process.env[...]`. A key pasted into a CI secret, a `.env` file or a shell arrives with
 * whitespace more often than anyone expects, and the failure it produces is silent and
 * expensive to diagnose.
 *
 * The asymmetry is what makes it silent. `Headers` normalises TRAILING whitespace away, so a
 * key ending in a space or a newline works fine — which is most accidents, and it teaches you
 * that whitespace is harmless. A LEADING space survives: `Bearer  <key>` goes out with two
 * spaces and the provider answers 401. That reaches the caller as `AUTH_FAILED`, a taxonomy
 * member that means "your credential was refused", pointing at the key's VALUE when the value
 * is correct and the framing is not.
 *
 * It cost most of a morning: five CI runs, a rotated production credential and two zone
 * rebuilds, chasing a provider's configuration. The three adapters that put the key in a query
 * string were unaffected throughout, because `URLSearchParams` encodes the space rather than
 * sending it — so exactly one provider looked broken and the other three looked fine.
 *
 * Empty after trimming is `undefined`, not `''`: "set to whitespace" and "not set" are the
 * same state and every caller already branches on absence.
 */
export function providerKeyFromEnv(
	id: string,
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const raw = env[`${id.toUpperCase().replace(/-/g, '_')}_KEY`];
	const trimmed = raw?.trim();
	return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
