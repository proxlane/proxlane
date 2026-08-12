// Entry point for `@better-auth/cli generate` only. It imports the real factory so the
// generated schema can never drift from the configuration the app actually builds.
import { createAuth } from './src/auth.js';
export const auth = createAuth({
	database: {} as never,
	secret: 'generate-only',
	baseURL: 'http://localhost',
	github: { clientId: 'x', clientSecret: 'x' },
	google: { clientId: 'x', clientSecret: 'x' },
});
