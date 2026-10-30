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
} as const;

/** What a token carries. The self-hosted gateway's env, sealed: provider keys and an order. */
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
 * Why a token did not open. All four are a 401 to the caller; the distinction is for logs and
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
	| 'invalid';

export type OpenedToken =
	| {
			readonly ok: true;
			readonly payload: TokenPayload;
			readonly id: string;
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
	 * The id is a hash of the token as presented: what rate limits, the denylist and logs key on,
	 * so the token itself never has to be stored or printed anywhere.
	 *
	 * Unknown payload fields are IGNORED, never refused. The connect page and the gateway deploy
	 * separately, so a page that learns a new optional field ships it before the gateway can read
	 * it, and every token it minted in between must still work.
	 */
	open(token: string): OpenedToken;
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
	return {
		publicKey: PUBLIC_PREFIX + b64(s, current.publicKey),
		kids,
		open: (token) => openWith(s, pairs, token),
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
		payload:
			cleanOrder === undefined
				? { keys: clean, issuedAt }
				: { keys: clean, order: cleanOrder, issuedAt },
	};
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

/** `TokenKeyring.open`, with the keyring's library and pairs. */
function openWith(s: Sodium, pairs: Pairs, token: string): OpenedToken {
	if (token.length > TOKEN_LIMITS.tokenLength) return { ok: false, reason: 'malformed' };
	const shape = TOKEN_SHAPE.exec(token);
	if (shape === null) return { ok: false, reason: 'malformed' };
	const [, kid = '', body = ''] = shape;
	const pair = pairs.get(kid);
	if (pair === undefined) return { ok: false, reason: 'unknown-key' };

	const sealed = unb64(s, body);
	if (sealed === undefined || sealed.length <= s.crypto_box_SEALBYTES)
		return { ok: false, reason: 'malformed' };
	let plaintext: string;
	try {
		plaintext = s.to_string(s.crypto_box_seal_open(sealed, pair.publicKey, pair.secretKey));
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
	const { keys, order, iat } = wire as { keys?: unknown; order?: unknown; iat?: unknown };
	const checked = checkPayload(keys, order, iat);
	if (!checked.ok) return { ok: false, reason: 'invalid' };
	return { ok: true, payload: checked.payload, id: idOf(s, token), kid };
}

function idOf(s: Sodium, token: string): string {
	return s.to_hex(s.crypto_generichash(16, s.from_string(token), null));
}

/**
 * A token's id without a keyring, for tools that revoke or look up a token they hold but cannot
 * open. The same value `TokenKeyring.open` returns.
 */
export async function tokenId(token: string): Promise<string> {
	return idOf(await sodium(), token);
}
