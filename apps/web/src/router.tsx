import { createRouter } from '@tanstack/react-router';
import { NotFound } from './components/not-found.js';
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
		// A 404 THAT SAYS WHERE TO GO NEXT. The default rendered the words "Not Found" inside
		// the site chrome and nothing else, which is a dead end for a person and worse for an
		// agent: it has a correct 404 status and no way to recover from it. The component names
		// the three machine-readable indexes by URL, so a crawler that guessed a path wrong can
		// read one and try again instead of concluding the site is empty.
		defaultNotFoundComponent: NotFound,
	});
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
