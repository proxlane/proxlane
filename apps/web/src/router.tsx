import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen.js';

/**
 * The router factory Start looks for.
 *
 * It must be named `getRouter` — Start's generated entry imports that symbol by name from
 * this module, and a differently-named export fails at BUILD time with `"getRouter" is not
 * exported`, which reads like a missing file rather than a naming convention.
 */
export function getRouter() {
	return createRouter({
		routeTree,
		defaultPreload: 'intent',
		scrollRestoration: true,
	});
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
