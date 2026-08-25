import { describe, expect, it } from 'vitest';
import { providerKeyFromEnv } from './env.js';

describe('providerKeyFromEnv', () => {
	const env = (v: string | undefined) => ({ SCRAPERAPI_KEY: v });

	it('trims a LEADING space, which is the one that breaks auth', () => {
		// `Headers` normalises trailing whitespace away, so a key ending in a space works and
		// teaches you whitespace is harmless. A leading one survives into `Bearer  <key>` with
		// two spaces and the provider answers 401 — reported as AUTH_FAILED, which points at
		// the key's value when the value was right all along.
		expect(providerKeyFromEnv('scraperapi', env(' abc123'))).toBe('abc123');
	});

	it('trims trailing whitespace and newlines, which a piped secret carries', () => {
		expect(providerKeyFromEnv('scraperapi', env('abc123\n'))).toBe('abc123');
		expect(providerKeyFromEnv('scraperapi', env('abc123 '))).toBe('abc123');
		expect(providerKeyFromEnv('scraperapi', env('\tabc123\r\n'))).toBe('abc123');
	});

	it('treats whitespace-only as not set, because those are the same state', () => {
		expect(providerKeyFromEnv('scraperapi', env('   '))).toBeUndefined();
		expect(providerKeyFromEnv('scraperapi', env(''))).toBeUndefined();
		expect(providerKeyFromEnv('scraperapi', env(undefined))).toBeUndefined();
	});

	it('preserves a key whose SHAPE contains a space after trimming', () => {
		// Bright Data's key is `<zone>:<token>` and the adapter splits it. Trimming the ends
		// must not touch the middle, or a zone name would silently change.
		expect(providerKeyFromEnv('scraperapi', env('  proxlane: abc  '))).toBe('proxlane: abc');
	});

	it('maps a hyphenated adapter id to an underscored variable', () => {
		expect(providerKeyFromEnv('some-provider', { SOME_PROVIDER_KEY: ' k ' })).toBe('k');
	});
});
