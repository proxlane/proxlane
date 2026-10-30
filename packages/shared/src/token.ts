// The hosted gateway's tenant token: a user's provider keys, sealed to the gateway.
//
// `plan.md` section 2, "Hosted BYOK": the hosted gateway stores no provider key. The connect page
// seals the keys IN THE BROWSER with the gateway's public key, and the ciphertext is the token.
// The gateway opens it per request and drops it. So the token is the whole tenant: there is no
// row behind it, and the format below is the only contract between the page that mints it and
// the gateway that reads it. The two deploy separately, which is why every rule here is
// forward-compatible on purpose.
//
// A SUBPATH, NEVER RE-EXPORTED FROM THE INDEX. libsodium is a few hundred kilobytes of
// WebAssembly; adapters, the detector, the SDK and the CLI import `@proxlane/shared` and need none
// of it. And it initialises LAZILY, never at import: TanStack Start renders the connect page on a
// Worker too, and a Worker must be able to import this module without compiling WebAssembly.
//
// Three strings, each with its own prefix so a scanner can tell them apart on sight:
//
//   pxlsk1_<base64url 32 bytes>          the gateway's secret key. Env only, never logged
//   pxlpk1_<base64url 32 bytes>          its public key. Published; the connect page seals to it
//   pxl1_<kid>_<base64url sealed box>    a tenant token. `kid` names the keypair that opens it
//
// The `1` in each is the FORMAT version. The payload carries its own `v`, so a new field never
// needs a new prefix, and a new prefix means the envelope itself changed.

type Sodium = typeof import('libsodium-wrappers')['default'];

let loading: Promise<Sodium> | undefined;

/**
 * The ready library, IMPORTED on first use. A static import would not be lazy enough: the
 * library starts instantiating its WebAssembly when the module is evaluated, so the import alone
 * would do the work the header says a Worker must never do. Dynamic, it is also its own chunk,
 * and the connect page downloads it only when someone seals.
 */
function sodium(): Promise<Sodium> {
	loading ??= import('libsodium-wrappers').then(async ({ default: s }) => {
		await s.ready;
		return s;
	});
	// A failed chunk load in the browser is usually a flaky network. Forget it, so the next seal
	// retries instead of failing forever on a rejection cached at module scope.
	loading.catch(() => {
		loading = undefined;
	});
	return loading;
}

const SECRET_PREFIX = 'pxlsk1_';
const PUBLIC_PREFIX = 'pxlpk1_';
export const TOKEN_PREFIX = 'pxl1_';

/**
 * Bounds, all checked BEFORE any decoding or decryption, so an oversized header costs a length
 * comparison and nothing else.
 *
 * Sized against Node's 16 KiB default header limit with room for the rest of the request. The
 * longest real key today is Bright Data's `<zone>:<token>`, well under 200 characters.
 */
export const TOKEN_LIMITS = {
	providers: 16,
	keyLength: 512,
	plaintextBytes: 4096,
	tokenLength: 6144,
	/** How far ahead of the gateway's clock a seal may be dated. Past it, the date is a lie. */
	clockSkewSeconds: 300,
} as const;

/**
 * Payload fields a token may mark as critical that this module understands. None yet.
 *
 * Ignoring unknown fields is right for a field that ADDS something and wrong for one that
 * RESTRICTS: a page that learns `budget` would mint tokens an older gateway serves without one,
 * and the user would be less protected than the page told them. So a restricting field is listed
 * in the payload's `crit`, and a gateway that does not know a name in `crit` refuses the token as
 * `unsupported` rather than serving it unrestricted. A field moves into this set in the same PR
 * that enforces it.
 */
const UNDERSTOOD_CRITICAL: ReadonlySet<string> = new Set();

/**
 * What a token carries. The self-hosted gateway's env, sealed: provider keys and an order.
 *
 * REDACTED WHEN PRINTED. `JSON.stringify` and `util.inspect` show `[redacted]` in place of every
 * key, so a `log.info({ opened })` on the hot path cannot write a user's provider keys to disk.
 * Reading `payload.keys.scraperapi` still gives the key; only serialisation is covered.
 */
export interface TokenPayload {
	/** Provider id to that provider's key, exactly as `<ID>_KEY` would hold it. */
	readonly keys: Readonly<Record<string, string>>;
	/**
	 * The order the chain tries providers in, as `PROXLANE_PROVIDER_ORDER` would give it.
	 * Absent means the gateway's default. Every id in it has a key.
	 */
	readonly order?: readonly string[];
	/**
	 * Unix SECONDS at sealing. ASSERTED BY WHOEVER SEALED IT: the public key is public, so anyone
	 * can mint a token with any date. Good for "this token is old", never for authorisation.
	 */
	readonly issuedAt: number;
}

export type TokenInput = Omit<TokenPayload, 'issuedAt'>;

/**
 * Why a token did not open. All five are a 401 to the caller; the distinction is for logs and
 * `proxlane doctor`, which can say "this token is from a retired key" instead of "invalid".
 */
export type TokenRefusal =
	/** Not shaped like a token at all, or over the length limit. */
	| 'malformed'
	/** Shaped right, sealed to a keypair this gateway does not hold: retired, or another gateway's. */
	| 'unknown-key'
	/** The keypair matched and the box did not open: altered in transit or by hand. */
	| 'unreadable'
	/** Opened, and the contents break the rules below. Only a hand-sealed token gets here. */
	| 'invalid'
	/** Opened and valid, and marks a field critical that this gateway cannot enforce. Upgrade it. */
	| 'unsupported';

export type OpenedToken =
	| {
			readonly ok: true;
			readonly payload: TokenPayload;
			/** This token. What the denylist keys on. */
			readonly id: string;
			/**
			 * Each provider key, by provider id, as an opaque hash. What rate limits and cooldowns key
			 * on, because the token id cannot be: anyone can seal the same keys again for a fresh id.
			 */
			readonly credentials: Readonly<Record<string, string>>;
			readonly kid: string;
	  }
	| { readonly ok: false; readonly reason: TokenRefusal };

/** The keypairs a gateway opens tokens with. The first one is current; the rest are retiring. */
export interface TokenKeyring {
	/** The current public key, `pxlpk1_…`, for the connect page to seal to. */
	readonly publicKey: string;
	/** Every kid this keyring opens, current first. */
	readonly kids: readonly string[];
	/**
	 * The payload of a token, or why not. SYNCHRONOUS, because the keyring already holds a ready
	 * library: this sits on the hot path of every hosted request.
	 *
	 * Two kinds of identity come back, because one cannot do both jobs. The token `id` names this
	 * token and nothing else; a leaked token is denied by it, and its holder cannot reseal the box
	 * to escape. But the public key is public, so the OWNER of a set of keys can mint a new token
	 * for every request, and a rate limit on `id` limits nothing. Limits and cooldowns key on
	 * `credentials`, a hash per provider key, which is the same however many times it is sealed.
	 * Those hashes are KEYED with a secret derived from the current gateway key, so a log full of
	 * them cannot be used to test guesses at a provider key offline. Rotating the current key
	 * changes every one of them, once, which resets limits and cooldowns for that rotation.
	 *
	 * NOT FREE TO CALL. A token naming a real kid costs an X25519 operation to refuse, and the kid
	 * is public. The caller rate-limits by source address BEFORE opening.
	 *
	 * A seal dated more than `TOKEN_LIMITS.clockSkewSeconds` ahead of `now` is refused, so a
	 * maximum token age can be enforced later against a date the token's thief cannot change.
	 *
	 * Unknown payload fields are IGNORED, unless the payload lists them in `crit`. The connect page
	 * and the gateway deploy separately, so a page that learns a new optional field ships it before
	 * the gateway can read it, and every token it minted in between must still work. A field that
	 * restricts the token is the exception, and `UNDERSTOOD_CRITICAL` says why.
	 */
	open(token: string, now?: number): OpenedToken;
}

type Pairs = Map<string, { readonly publicKey: Uint8Array; readonly secretKey: Uint8Array }>;

// ---- keys ----------------------------------------------------------------------------------

function b64(s: Sodium, bytes: Uint8Array): string {
	return s.to_base64(bytes, s.base64_variants.URLSAFE_NO_PADDING);
}

/** Decoded bytes, or `undefined` for anything that is not unpadded base64url. */
function unb64(s: Sodium, text: string): Uint8Array | undefined {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
	try {
		return s.from_base64(text, s.base64_variants.URLSAFE_NO_PADDING);
	} catch {
		return undefined;
	}
}

/** 32 bytes behind `prefix`, or a thrown error naming which of the two keys was wrong. */
function decodeKey(s: Sodium, text: string, prefix: string, what: string): Uint8Array {
	const bytes = text.startsWith(prefix)
		? unb64(s, text.slice(prefix.length).trim())
		: undefined;
	if (bytes?.length !== s.crypto_box_PUBLICKEYBYTES) {
		throw new TypeError(`not a token ${what}: expected ${prefix} and 32 bytes of base64url`);
	}
	return bytes;
}

/**
 * Eight hex characters naming a keypair, derived from its public key. DERIVED rather than
 * configured, so a keyring needs nothing but its secret keys and two gateways holding the same key
 * agree on its name without being told.
 */
function kidOf(s: Sodium, publicKey: Uint8Array): string {
	return s.to_hex(s.crypto_generichash(16, publicKey, null)).slice(0, 8);
}

/** A fresh gateway keypair, as the strings an operator stores and publishes. */
export async function generateTokenKeypair(): Promise<{
	readonly secretKey: string;
	readonly publicKey: string;
	readonly kid: string;
}> {
	const s = await sodium();
	const pair = s.crypto_box_keypair();
	return {
		secretKey: SECRET_PREFIX + b64(s, pair.privateKey),
		publicKey: PUBLIC_PREFIX + b64(s, pair.publicKey),
		kid: kidOf(s, pair.publicKey),
	};
}

/**
 * The keyring a gateway opens tokens with, from its secret keys, newest first.
 *
 * ROTATION is a second entry, never a swap: put the new key first and keep the old one behind it
 * until every token sealed to it has been replaced. Dropping the old key at once logs every user
 * of it out with `unknown-key`, which is the right outcome for a leaked key and the wrong one for
 * routine rotation.
 *
 * THROWS on any bad entry. This runs at boot, and a gateway that started with half a keyring
 * would refuse its users' tokens one by one with nothing in the log to say why.
 */
export async function loadTokenKeyring(secretKeys: readonly string[]): Promise<TokenKeyring> {
	if (secretKeys.length === 0)
		throw new TypeError('a token keyring needs at least one secret key');
	const s = await sodium();
	const pairs: Pairs = new Map();
	for (const text of secretKeys) {
		const secretKey = decodeKey(s, text.trim(), SECRET_PREFIX, 'secret key');
		const publicKey = s.crypto_scalarmult_base(secretKey);
		const kid = kidOf(s, publicKey);
		if (pairs.has(kid)) throw new TypeError(`the token keyring lists key ${kid} twice`);
		pairs.set(kid, { publicKey, secretKey });
	}
	const kids = [...pairs.keys()];
	const current = pairs.get(kids[0] ?? '');
	if (current === undefined)
		throw new TypeError('a token keyring needs at least one secret key');
	// Its own subkey, never the secret key itself: one secret, two unrelated uses.
	const credentialKey = s.crypto_kdf_derive_from_key(32, 1, 'pxlcreds', current.secretKey);
	return {
		publicKey: PUBLIC_PREFIX + b64(s, current.publicKey),
		kids,
		open: (token, now = Date.now()) => openWith(s, pairs, credentialKey, token, now),
	};
}

// ---- the payload ---------------------------------------------------------------------------

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Printable ASCII, no spaces. A key travels in a header or a query string to the provider, and a
 * CR or LF in it is header injection; `Headers` would throw, but only after the token was accepted
 * and with an error that names neither the token nor the provider.
 */
const KEY_CHARS = /^[\x21-\x7e]+$/;

/**
 * The payload in its checked, normalised form, or the first rule it breaks.
 *
 * ONE function for both directions. Sealing runs it so the page cannot mint a token the gateway
 * would refuse; opening runs it because the public key is public and a token can be sealed by
 * hand. Provider ids are checked for SHAPE only: `shared` cannot see the adapter registry, so
 * whether `acme` is a provider is the gateway's question, and a page newer than the gateway must
 * not have its tokens refused for naming one.
 *
 * Keys are TRIMMED, for the reason `providerKeyFromEnv` gives at length: a leading space survives
 * into `Bearer  <key>` and the provider answers 401.
 */
function checkPayload(
	keys: unknown,
	order: unknown,
	issuedAt: unknown,
): { ok: true; payload: TokenPayload } | { ok: false; why: string } {
	if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
		return { ok: false, why: 'keys must be an object of provider id to key' };
	}
	const entries = Object.entries(keys);
	if (entries.length === 0)
		return { ok: false, why: 'a token needs at least one provider key' };
	if (entries.length > TOKEN_LIMITS.providers) {
		return { ok: false, why: `at most ${TOKEN_LIMITS.providers} providers` };
	}
	const clean: Record<string, string> = {};
	for (const [id, raw] of entries) {
		if (!PROVIDER_ID.test(id))
			return { ok: false, why: `"${id.slice(0, 40)}" is not a provider id` };
		const key = typeof raw === 'string' ? raw.trim() : '';
		if (key === '') return { ok: false, why: `the key for ${id} is empty` };
		if (key.length > TOKEN_LIMITS.keyLength)
			return { ok: false, why: `the key for ${id} is too long` };
		if (!KEY_CHARS.test(key)) {
			return {
				ok: false,
				why: `the key for ${id} has a space or a character a header cannot carry`,
			};
		}
		clean[id] = key;
	}

	let cleanOrder: string[] | undefined;
	if (order !== undefined) {
		if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) {
			return { ok: false, why: 'order must be a list of provider ids' };
		}
		// Empty is not "the default order", it is a chain with nothing in it. Absent means default.
		if (order.length === 0)
			return { ok: false, why: 'order is empty; leave it out for the default' };
		// Every entry must have a key. Self-host refuses an unknown id in PROXLANE_PROVIDER_ORDER
		// because a typo there silently changes who is paid first; this is the same check, against
		// the one list the token can see.
		const missing = order.find((id) => !Object.hasOwn(clean, id));
		if (missing !== undefined)
			return { ok: false, why: `order names ${missing.slice(0, 40)}, which has no key` };
		if (new Set(order).size !== order.length)
			return { ok: false, why: 'order names a provider twice' };
		cleanOrder = [...order];
	}

	if (typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || issuedAt <= 0) {
		return { ok: false, why: 'issuedAt must be unix seconds' };
	}
	return {
		ok: true,
		payload: redacted(
			cleanOrder === undefined
				? { keys: clean, issuedAt }
				: { keys: clean, order: cleanOrder, issuedAt },
		),
	};
}

/** The payload with `toJSON` and the inspect hook attached, both non-enumerable. See `TokenPayload`. */
function redacted(payload: TokenPayload): TokenPayload {
	const shown = () => ({
		...payload,
		keys: Object.fromEntries(Object.keys(payload.keys).map((id) => [id, '[redacted]'])),
	});
	return Object.defineProperties(payload, {
		toJSON: { value: shown },
		[Symbol.for('nodejs.util.inspect.custom')]: { value: shown },
	});
}

// ---- sealing and opening -------------------------------------------------------------------

/**
 * A token for these keys, sealed to `publicKey`. Runs in the browser; nothing it is given leaves
 * the page except inside the box.
 *
 * THROWS a `TypeError` naming the rule on bad input. The caller is our own connect page, which
 * shows the message beside the field; a result type would only be unwrapped into the same throw.
 *
 * Sealing the same keys twice gives two different tokens, by design of the sealed box (a fresh
 * ephemeral key each time). So a token's id names that token, not the keys inside it.
 */
export async function sealToken(
	input: TokenInput,
	publicKey: string,
	now = Date.now(),
): Promise<string> {
	const s = await sodium();
	const recipient = decodeKey(s, publicKey.trim(), PUBLIC_PREFIX, 'public key');
	const checked = checkPayload(input.keys, input.order, Math.floor(now / 1000));
	if (!checked.ok) throw new TypeError(checked.why);
	const { keys, order, issuedAt } = checked.payload;
	const plaintext = s.from_string(
		JSON.stringify(
			order === undefined
				? { v: 1, iat: issuedAt, keys }
				: { v: 1, iat: issuedAt, keys, order },
		),
	);
	if (plaintext.length > TOKEN_LIMITS.plaintextBytes)
		throw new TypeError('too many keys, or keys too long, for one token');
	return `${TOKEN_PREFIX}${kidOf(s, recipient)}_${b64(s, s.crypto_box_seal(plaintext, recipient))}`;
}

const TOKEN_SHAPE = /^pxl1_([0-9a-f]{8})_([A-Za-z0-9_-]+)$/;

/** `TokenKeyring.open`, with the keyring's library, pairs and credential key. */
function openWith(
	s: Sodium,
	pairs: Pairs,
	credentialKey: Uint8Array,
	token: string,
	now: number,
): OpenedToken {
	const parsed = parseToken(s, token);
	if (parsed === undefined) return { ok: false, reason: 'malformed' };
	const pair = pairs.get(parsed.kid);
	if (pair === undefined) return { ok: false, reason: 'unknown-key' };

	let plaintext: string;
	try {
		plaintext = s.to_string(
			s.crypto_box_seal_open(parsed.sealed, pair.publicKey, pair.secretKey),
		);
	} catch {
		return { ok: false, reason: 'unreadable' };
	}

	let wire: unknown;
	try {
		wire = JSON.parse(plaintext);
	} catch {
		return { ok: false, reason: 'invalid' };
	}
	if (typeof wire !== 'object' || wire === null || (wire as { v?: unknown }).v !== 1) {
		return { ok: false, reason: 'invalid' };
	}
	const { keys, order, iat, crit } = wire as Record<string, unknown>;
	const checked = checkPayload(keys, order, iat);
	if (!checked.ok) return { ok: false, reason: 'invalid' };
	if (checked.payload.issuedAt > now / 1000 + TOKEN_LIMITS.clockSkewSeconds) {
		return { ok: false, reason: 'invalid' };
	}
	if (crit !== undefined) {
		if (!Array.isArray(crit) || !crit.every((f) => typeof f === 'string')) {
			return { ok: false, reason: 'invalid' };
		}
		if (!crit.every((f) => UNDERSTOOD_CRITICAL.has(f)))
			return { ok: false, reason: 'unsupported' };
	}

	const credentials: Record<string, string> = {};
	for (const [id, key] of Object.entries(checked.payload.keys)) {
		// The provider id is part of the input: the same string accepted by two providers is two
		// accounts, and must not share a cooldown.
		credentials[id] = s.to_hex(
			s.crypto_generichash(16, s.from_string(`${id}\n${key}`), credentialKey),
		);
	}
	return {
		ok: true,
		payload: checked.payload,
		id: idOf(s, parsed.sealed),
		credentials,
		kid: parsed.kid,
	};
}

/**
 * The kid and the decoded box, or `undefined` for anything not shaped like a token. Length first,
 * so an oversized header costs a comparison and nothing else.
 */
function parseToken(s: Sodium, token: string): { kid: string; sealed: Uint8Array } | undefined {
	if (token.length > TOKEN_LIMITS.tokenLength) return undefined;
	const shape = TOKEN_SHAPE.exec(token);
	if (shape === null) return undefined;
	const [, kid = '', body = ''] = shape;
	const sealed = unb64(s, body);
	if (sealed === undefined || sealed.length <= s.crypto_box_SEALBYTES) return undefined;
	return { kid, sealed };
}

/**
 * Hashed from the DECODED box, not the string. Two spellings of one box would be two ids, and a
 * denied token would come back under the second. libsodium refuses non-canonical base64 today (a
 * test holds it to that); this does not depend on it.
 */
function idOf(s: Sodium, sealed: Uint8Array): string {
	return s.to_hex(s.crypto_generichash(16, sealed, null));
}

/**
 * A token's id without a keyring, for tools that deny or look up a token they hold but cannot
 * open. The same value `TokenKeyring.open` returns, or `undefined` for a string that is not a
 * token.
 */
export async function tokenId(token: string): Promise<string | undefined> {
	const s = await sodium();
	const parsed = parseToken(s, token);
	return parsed === undefined ? undefined : idOf(s, parsed.sealed);
}
