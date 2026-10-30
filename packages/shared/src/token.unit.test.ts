// The tenant token is the hosted gateway's whole tenant: no row stands behind it, and the page
// that mints it deploys separately from the gateway that opens it. So the envelope, every refusal
// and the forward-compatibility rule are asserted here, against real libsodium, nothing mocked.

import _sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	generateTokenKeypair,
	loadTokenKeyring,
	sealToken,
	TOKEN_LIMITS,
	TOKEN_PREFIX,
	type TokenKeyring,
	tokenId,
} from './token.js';

let pair: Awaited<ReturnType<typeof generateTokenKeypair>>;
let keyring: TokenKeyring;

beforeAll(async () => {
	pair = await generateTokenKeypair();
	keyring = await loadTokenKeyring([pair.secretKey]);
});

const KEYS = { scraperapi: 'sa-0123456789abcdef', brightdata: 'unlocker_zone:bd-token-0123' };
/** In the past, so tokens sealed at it open under the real clock too. */
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);

/** A token sealed by hand, as anyone holding the public key can, around any plaintext at all. */
async function sealRaw(plaintext: string, publicKey = pair.publicKey): Promise<string> {
	await _sodium.ready;
	const s = _sodium;
	const recipient = s.from_base64(
		publicKey.slice('pxlpk1_'.length),
		s.base64_variants.URLSAFE_NO_PADDING,
	);
	const box = s.crypto_box_seal(s.from_string(plaintext), recipient);
	const kid = s.to_hex(s.crypto_generichash(16, recipient, null)).slice(0, 8);
	return `${TOKEN_PREFIX}${kid}_${s.to_base64(box, s.base64_variants.URLSAFE_NO_PADDING)}`;
}

describe('the three strings', () => {
	it('carries a distinct prefix on each, so a scanner can tell them apart', () => {
		expect(pair.secretKey).toMatch(/^pxlsk1_[A-Za-z0-9_-]{43}$/);
		expect(pair.publicKey).toMatch(/^pxlpk1_[A-Za-z0-9_-]{43}$/);
		expect(pair.kid).toMatch(/^[0-9a-f]{8}$/);
	});

	it('derives the public key and kid from the secret key alone', async () => {
		expect(keyring.publicKey).toBe(pair.publicKey);
		expect(keyring.kids).toEqual([pair.kid]);
	});

	it('names the keypair in the token, so the gateway knows which key to try', async () => {
		const token = await sealToken({ keys: KEYS }, pair.publicKey, T0);
		expect(token.startsWith(`${TOKEN_PREFIX}${pair.kid}_`)).toBe(true);
		expect(token.length).toBeLessThan(TOKEN_LIMITS.tokenLength);
	});
});

describe('a sealed token opens to what went in', () => {
	it('round-trips keys, order and the second it was sealed', async () => {
		const token = await sealToken(
			{ keys: KEYS, order: ['brightdata', 'scraperapi'] },
			pair.publicKey,
			T0 + 999,
		);
		const opened = keyring.open(token);
		expect(opened).toEqual({
			ok: true,
			payload: { keys: KEYS, order: ['brightdata', 'scraperapi'], issuedAt: T0 / 1000 },
			id: await tokenId(token),
			credentials: {
				scraperapi: expect.stringMatching(/^[0-9a-f]{32}$/),
				brightdata: expect.any(String),
			},
			kid: pair.kid,
		});
	});

	it('leaves order out when none was given, rather than inventing one', async () => {
		const opened = keyring.open(await sealToken({ keys: KEYS }, pair.publicKey, T0));
		expect(opened.ok && 'order' in opened.payload).toBe(false);
	});

	it('trims keys, because a leading space survives into `Bearer  <key>`', async () => {
		const opened = keyring.open(
			await sealToken({ keys: { scraperapi: '  sa-key\n' } }, pair.publicKey, T0),
		);
		expect(opened.ok && opened.payload.keys.scraperapi).toBe('sa-key');
	});

	it('gives the same keys sealed twice two tokens with two ids', async () => {
		const a = await sealToken({ keys: KEYS }, pair.publicKey, T0);
		const b = await sealToken({ keys: KEYS }, pair.publicKey, T0);
		expect(a).not.toBe(b);
		expect(await tokenId(a)).not.toBe(await tokenId(b));
	});

	it('gives every spelling of one box the same id, so a denied token cannot come back', async () => {
		// libsodium refuses non-canonical base64 today. Pinned here, and the id is hashed from the
		// decoded box besides, so the denylist does not rest on either alone.
		await _sodium.ready;
		// [1,2,3,4] is `AQIDBA`; `AQIDBB` differs only in bits the decoder should discard.
		expect(() =>
			_sodium.from_base64('AQIDBB', _sodium.base64_variants.URLSAFE_NO_PADDING),
		).toThrow();
		expect(await tokenId('changeme')).toBeUndefined();
	});

	it('never puts a key in the id', async () => {
		const token = await sealToken({ keys: KEYS }, pair.publicKey, T0);
		const id = await tokenId(token);
		expect(id).toMatch(/^[0-9a-f]{32}$/);
		expect(token).not.toContain(KEYS.scraperapi);
	});
});

describe('limits key on the credentials, because anyone can reseal their own keys', () => {
	it('gives the same provider key the same hash however many times it is sealed', async () => {
		const a = keyring.open(await sealToken({ keys: KEYS }, pair.publicKey, T0));
		const b = keyring.open(
			await sealToken({ keys: { scraperapi: KEYS.scraperapi } }, pair.publicKey, T0),
		);
		expect(a.ok && b.ok && a.id !== b.id).toBe(true);
		expect(a.ok && b.ok && a.credentials.scraperapi === b.credentials.scraperapi).toBe(true);
	});

	it('gives one string accepted by two providers two hashes: two accounts, two cooldowns', async () => {
		const opened = keyring.open(
			await sealToken({ keys: { scraperapi: 'same', scrapfly: 'same' } }, pair.publicKey, T0),
		);
		expect(opened.ok && opened.credentials.scraperapi !== opened.credentials.scrapfly).toBe(
			true,
		);
	});

	it('keys the hash on the gateway secret, so a logged hash cannot test a guessed key offline', async () => {
		const other = await generateTokenKeypair();
		const theirs = await loadTokenKeyring([other.secretKey]);
		const mine = keyring.open(await sealToken({ keys: KEYS }, pair.publicKey, T0));
		const its = theirs.open(await sealToken({ keys: KEYS }, other.publicKey, T0));
		expect(
			mine.ok && its.ok && mine.credentials.scraperapi !== its.credentials.scraperapi,
		).toBe(true);
	});
});

describe('a printed payload shows no key', () => {
	it('redacts JSON and inspect, and still reads the key directly', async () => {
		const opened = keyring.open(await sealToken({ keys: KEYS }, pair.publicKey, T0));
		if (!opened.ok) throw new Error('did not open');
		const { inspect } = await import('node:util');
		for (const printed of [JSON.stringify({ opened }), inspect(opened, { depth: 9 })]) {
			expect(printed).not.toContain(KEYS.scraperapi);
			expect(printed).toContain('[redacted]');
		}
		expect(opened.payload.keys.scraperapi).toBe(KEYS.scraperapi);
	});
});

describe('rotation is a second entry, never a swap', () => {
	it('opens tokens from the retiring key while sealing to the new one', async () => {
		const next = await generateTokenKeypair();
		const rotated = await loadTokenKeyring([next.secretKey, pair.secretKey]);
		expect(rotated.publicKey).toBe(next.publicKey);
		expect(rotated.kids).toEqual([next.kid, pair.kid]);

		const old = await sealToken({ keys: KEYS }, pair.publicKey, T0);
		expect(rotated.open(old)).toMatchObject({ ok: true, kid: pair.kid });
	});

	it('refuses a token from a key that has left the keyring as unknown-key, not unreadable', async () => {
		const other = await generateTokenKeypair();
		const token = await sealToken({ keys: KEYS }, other.publicKey, T0);
		expect(keyring.open(token)).toEqual({ ok: false, reason: 'unknown-key' });
	});

	it('refuses to load a keyring that is empty, malformed or lists a key twice', async () => {
		await expect(loadTokenKeyring([])).rejects.toThrow(/at least one/);
		await expect(loadTokenKeyring(['changeme'])).rejects.toThrow(/pxlsk1_/);
		await expect(loadTokenKeyring([pair.publicKey])).rejects.toThrow(/pxlsk1_/);
		await expect(loadTokenKeyring([`${pair.secretKey.slice(0, -2)}`])).rejects.toThrow(
			/32 bytes/,
		);
		await expect(loadTokenKeyring([pair.secretKey, ` ${pair.secretKey} `])).rejects.toThrow(
			/twice/,
		);
	});
});

describe('opening refuses, and says which way', () => {
	it('is malformed for anything not shaped like a token, before any crypto', () => {
		for (const t of [
			'',
			'changeme',
			'pxl1_',
			'pxl1_zzzzzzzz_abc',
			`pxl1_${pair.kid}_`,
			`pxl1_${pair.kid}_a b`,
		]) {
			expect(keyring.open(t)).toEqual({ ok: false, reason: 'malformed' });
		}
	});

	it('is malformed past the length limit, whatever follows the prefix', () => {
		const long = `pxl1_${pair.kid}_${'A'.repeat(TOKEN_LIMITS.tokenLength)}`;
		expect(keyring.open(long)).toEqual({ ok: false, reason: 'malformed' });
	});

	it('is unreadable when one character of the box has changed', async () => {
		const token = await sealToken({ keys: KEYS }, pair.publicKey, T0);
		const i = token.length - 10;
		const flipped = token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1);
		expect(keyring.open(flipped)).toEqual({ ok: false, reason: 'unreadable' });
	});

	it('is invalid when a hand-sealed box holds something other than a v1 payload', async () => {
		const iat = T0 / 1000;
		const bad = [
			'not json',
			'null',
			JSON.stringify({ v: 2, iat, keys: KEYS }),
			JSON.stringify({ iat, keys: KEYS }),
			JSON.stringify({ v: 1, iat, keys: {} }),
			JSON.stringify({ v: 1, iat, keys: [] }),
			JSON.stringify({ v: 1, iat: 'yesterday', keys: KEYS }),
			JSON.stringify({ v: 1, iat, keys: { 'Scraper API': 'k' } }),
			JSON.stringify({ v: 1, iat, keys: { scraperapi: 'k\r\nX-Injected: 1' } }),
			JSON.stringify({ v: 1, iat, keys: KEYS, order: ['scrapfly'] }),
			JSON.stringify({ v: 1, iat, keys: KEYS, order: ['scraperapi', 'scraperapi'] }),
			JSON.stringify({ v: 1, iat, keys: KEYS, order: [] }),
		];
		for (const plaintext of bad) {
			expect(keyring.open(await sealRaw(plaintext)), plaintext).toEqual({
				ok: false,
				reason: 'invalid',
			});
		}
	});

	it('is invalid when the seal is dated past the clock skew, so a maximum age stays enforceable', async () => {
		const ahead = T0 / 1000 + TOKEN_LIMITS.clockSkewSeconds + 60;
		const token = await sealRaw(JSON.stringify({ v: 1, iat: ahead, keys: KEYS }));
		expect(keyring.open(token, T0)).toEqual({ ok: false, reason: 'invalid' });
		expect(keyring.open(token, T0 + 120_000).ok).toBe(true);
	});

	it('is unsupported when it marks critical a field this gateway cannot enforce', async () => {
		const iat = T0 / 1000;
		const token = await sealRaw(
			JSON.stringify({ v: 1, iat, keys: KEYS, budget: { usd: 5 }, crit: ['budget'] }),
		);
		expect(keyring.open(token, T0)).toEqual({ ok: false, reason: 'unsupported' });
		const garbled = await sealRaw(JSON.stringify({ v: 1, iat, keys: KEYS, crit: 'budget' }));
		expect(keyring.open(garbled, T0)).toEqual({ ok: false, reason: 'invalid' });
	});

	it('IGNORES fields it does not know, so a newer connect page never locks its users out', async () => {
		const token = await sealRaw(
			JSON.stringify({ v: 1, iat: T0 / 1000, keys: KEYS, budget: { usd: 5 } }),
		);
		const opened = keyring.open(token);
		expect(opened).toMatchObject({ ok: true, payload: { keys: KEYS } });
		expect(opened.ok && 'budget' in opened.payload).toBe(false);
	});

	it('takes provider ids it has never heard of: whether one exists is the gateway question', async () => {
		const opened = keyring.open(
			await sealToken({ keys: { 'acme-unlocker': 'k1' } }, pair.publicKey, T0),
		);
		expect(opened.ok).toBe(true);
	});
});

describe('sealing refuses what opening would', () => {
	it('names the rule, for the connect page to show beside the field', async () => {
		const cases: [Parameters<typeof sealToken>[0], RegExp][] = [
			[{ keys: {} }, /at least one/],
			[{ keys: { scraperapi: '   ' } }, /empty/],
			[{ keys: { scraperapi: 'a b' } }, /header/],
			[{ keys: { ScraperAPI: 'k' } }, /not a provider id/],
			[{ keys: { scraperapi: 'x'.repeat(TOKEN_LIMITS.keyLength + 1) } }, /too long/],
			[{ keys: KEYS, order: ['scrapfly'] }, /no key/],
			[{ keys: KEYS, order: ['scraperapi', 'scraperapi'] }, /twice/],
			[{ keys: KEYS, order: [] }, /empty/],
			[
				{
					keys: Object.fromEntries(
						Array.from({ length: TOKEN_LIMITS.providers + 1 }, (_, i) => [`p${i}`, 'k']),
					),
				},
				/at most/,
			],
		];
		for (const [input, why] of cases) {
			await expect(sealToken(input, pair.publicKey, T0)).rejects.toThrow(why);
		}
	});

	it('refuses the plaintext limit even when each key is within its own', async () => {
		const keys = Object.fromEntries(
			Array.from({ length: TOKEN_LIMITS.providers }, (_, i) => [
				`provider-${i}`,
				'k'.repeat(TOKEN_LIMITS.keyLength),
			]),
		);
		await expect(sealToken({ keys }, pair.publicKey, T0)).rejects.toThrow(/too many keys/);
	});

	it('refuses to seal to anything but a public key, a secret key above all', async () => {
		await expect(sealToken({ keys: KEYS }, pair.secretKey, T0)).rejects.toThrow(/pxlpk1_/);
		await expect(sealToken({ keys: KEYS }, 'pxlpk1_short', T0)).rejects.toThrow(/32 bytes/);
	});
});

describe('the secret scanner recognises what this module emits', () => {
	/** The `regex` of one rule in the root `.gitleaks.toml`. RE2 and JS agree on these classes. */
	async function rule(id: string): Promise<RegExp> {
		const { readFile } = await import('node:fs/promises');
		const toml = await readFile(new URL('../../../.gitleaks.toml', import.meta.url), 'utf8');
		const block = toml.split('[[rules]]').find((b) => b.includes(`id = "${id}"`));
		const source = /regex = '''(.+)'''/.exec(block ?? '')?.[1];
		if (source === undefined) throw new Error(`.gitleaks.toml has no rule ${id}`);
		return new RegExp(source);
	}

	it('catches a secret key, and not the public key beside it', async () => {
		const secret = await rule('proxlane-token-secret-key');
		expect(secret.test(`PROXLANE_TOKEN_KEYS=${pair.secretKey}`)).toBe(true);
		expect(secret.test(pair.publicKey)).toBe(false);
	});

	it('catches the smallest token this module can seal', async () => {
		const token = await sealToken({ keys: { a: 'k' } }, pair.publicKey, T0);
		expect((await rule('proxlane-tenant-token')).test(`Authorization: Bearer ${token}`)).toBe(
			true,
		);
	});
});

describe('boxes the gateway seals for itself', () => {
	const LATER = T0 + 3_600_000;

	it('round-trips a value, and refuses it once expired', () => {
		const box = keyring.seal('access', { t: 'x', aud: 'https://g.test/mcp' }, LATER);
		expect(box).toMatch(new RegExp(`^pxa1_${pair.kid}_[A-Za-z0-9_-]+$`));
		expect(keyring.unseal('access', box, T0)).toEqual({
			ok: true,
			value: { t: 'x', aud: 'https://g.test/mcp' },
			kid: pair.kid,
		});
		expect(keyring.unseal('access', box, LATER + 1)).toEqual({ ok: false, reason: 'expired' });
	});

	it('never opens one purpose as another, so a code is not an access token', () => {
		const code = keyring.seal('code', { t: 'x' }, LATER);
		const asAccess = `pxa1_${code.slice('pxo1_'.length)}`;
		expect(keyring.unseal('access', asAccess, T0)).toEqual({ ok: false, reason: 'unreadable' });
		expect(keyring.unseal('access', code, T0)).toEqual({ ok: false, reason: 'malformed' });
	});

	it('opens boxes from a retiring key, and refuses a key that has left', async () => {
		const next = await generateTokenKeypair();
		const rotated = await loadTokenKeyring([next.secretKey, pair.secretKey]);
		const old = keyring.seal('refresh', { n: 1 }, LATER);
		expect(rotated.unseal('refresh', old, T0)).toMatchObject({ ok: true, kid: pair.kid });
		const theirs = (await loadTokenKeyring([next.secretKey])).seal('refresh', { n: 1 }, LATER);
		expect(keyring.unseal('refresh', theirs, T0)).toEqual({ ok: false, reason: 'unknown-key' });
	});

	it('refuses a box altered by one character', () => {
		const box = keyring.seal('client', { r: ['https://a.test/cb'] });
		const i = box.length - 8;
		const flipped = box.slice(0, i) + (box[i] === 'A' ? 'B' : 'A') + box.slice(i + 1);
		expect(keyring.unseal('client', flipped, T0)).toEqual({ ok: false, reason: 'unreadable' });
	});

	it('refuses junk before any decryption', () => {
		for (const junk of [
			'',
			'pxc1_',
			'pxc1_zz_abc',
			`pxc1_${pair.kid}_`,
			`pxc1_${'A'.repeat(20_000)}`,
		]) {
			expect(keyring.unseal('client', junk, T0)).toEqual({ ok: false, reason: 'malformed' });
		}
	});

	it('refuses to seal a code or token with no expiry, so none can live forever', () => {
		for (const purpose of ['consent', 'code', 'access', 'refresh'] as const) {
			expect(() => keyring.seal(purpose, {})).toThrow(/expiry/);
		}
		expect(() => keyring.seal('client', {})).not.toThrow();
	});

	it('gives the same value two different boxes, by its random nonce', () => {
		expect(keyring.seal('client', { a: 1 })).not.toBe(keyring.seal('client', { a: 1 }));
	});
});
