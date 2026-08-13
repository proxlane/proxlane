import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';

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
	plugins: [tailwindcss(), tanstackStart()],
});
