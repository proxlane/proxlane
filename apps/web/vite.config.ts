import { defineConfig } from 'vite';

// Deliberately undesigned. TanStack Start, Base UI and the token layer are
// design-engineer's; this exists so `pnpm dev` and `pnpm build` are honest commands
// rather than stubs. Replace the contents, not the wiring.
export default defineConfig({
	// 3787 pairs with the gateway's 8787 and stays off 3000, which collides with almost
	// everything. Same reasoning as compose.dev.yml's 5442/6389.
	//
	// strictPort so a busy port is an error rather than a silent move to the next one —
	// a dev server that quietly relocates makes `pnpm dev` pass while pointing somewhere
	// nobody is looking.
	server: { port: 3787, strictPort: true },
});
