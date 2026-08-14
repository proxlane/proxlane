import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { docsPlugin } from './vite-plugin-docs.js';

// TanStack Start, per `CLAUDE.md`'s decision. Not Next.js.
//
// Tailwind is the VITE plugin rather than PostCSS: v4 is CSS-first, and the `@theme` block in
// `@proxlane/ui/theme.css` only generates utilities when the plugin processes it. Wire it
// through PostCSS instead and the tokens still parse, still validate, and produce nothing —
// which looks like a styling bug rather than a build one.
export default defineConfig({
	// 3787 pairs with the gateway's 8787 and stays off 3000, which collides with almost
	// everything. Same reasoning as compose.dev.yml's 5442/6389.
	//
	// strictPort so a busy port is an error rather than a silent move to the next one — a dev
	// server that quietly relocates makes `pnpm dev` pass while pointing somewhere nobody is
	// looking.
	server: { port: 3787, strictPort: true },
	// react() AFTER tanstackStart(), and the order is enforced by the router plugin itself.
	// Start's dev mode requires a React Refresh runtime and returns 500 on EVERY page load
	// without one — while SSR still renders, so the page looks correct and simply never
	// hydrates. The error names `/@react-refresh` rather than the missing plugin.
	// cloudflare() FIRST, then tanstackStart(), then react(). Both orderings are load-bearing
	// and they were learned the hard way in opposite directions: Start must come before react()
	// or its router plugin refuses to start, and cloudflare() must come before Start or Start
	// resolves a Node server entry and the Worker bundle never forms.
	//
	// `viteEnvironment: { name: 'ssr' }` points the plugin at Start's SSR environment rather
	// than letting it create its own, which is what makes one build serve both targets.
	plugins: [
		// BEFORE everything: the docs transform must run on the raw file, and `enforce: 'pre'`
		// on the plugin itself is what guarantees that regardless of position here.
		docsPlugin(),
		cloudflare({ viteEnvironment: { name: 'ssr' } }),
		tailwindcss(),
		tanstackStart(),
		react(),
	],
});
