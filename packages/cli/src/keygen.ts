import { generateTokenKeypair } from '@proxlane/shared/token';
import { EXIT, emit, style } from './output.js';

// `proxlane keygen` — a keypair for a hosted gateway's tenant tokens.
//
// The secret key opens every token sealed to it, so it goes in PROXLANE_TOKEN_KEYS and nowhere
// else. The public key is printed only to check a deploy against: the gateway serves it at
// GET /token-key, and the connect page reads it from there.
//
// Generated here and printed once, never written to a file. Where it is stored is the
// operator's decision, and a CLI that wrote secrets to disk would make it for them.

export async function keygen(json: boolean): Promise<number> {
	const { secretKey, publicKey, kid } = await generateTokenKeypair();
	emit(
		{ ok: true, command: 'keygen', data: { secretKey, publicKey, kid } },
		json,
		() =>
			`${style('PROXLANE_TOKEN_KEYS', 'bold')}=${secretKey}\n\n` +
			`  Secret. Opens every token sealed to it: the gateway's env only, never a file you commit.\n` +
			`  To rotate, put a new one FIRST and keep this one behind it until its tokens are replaced:\n` +
			`  PROXLANE_TOKEN_KEYS=<new key>,<this key>\n\n` +
			`  public key  ${publicKey}\n` +
			`  kid         ${kid}\n` +
			`  The gateway serves the public key at GET /token-key; check a deploy against it.\n`,
	);
	return EXIT.OK;
}
