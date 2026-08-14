/// <reference types="vite/client" />

// `?docs` is transformed by `vite-plugin-docs.ts` into finished HTML at build time. The
// suffix is required: a bare `import './x.md'` has no transform and should fail loudly.
declare module '*.md?docs' {
	import type { RenderedDoc } from '../vite-plugin-docs.js';

	const doc: RenderedDoc;
	export default doc;
}

declare module 'virtual:docs-search' {
	import type { SearchRecord } from '../vite-plugin-docs.js';

	const index: SearchRecord[];
	export default index;
}
