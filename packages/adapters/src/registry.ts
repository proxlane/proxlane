import type { Adapter } from './contract.js';

// Every adapter, lazily loaded. Conformance is parameterized over this map, so registering
// here is what puts a new provider into the shared suite — there is no second list to
// remember.
export const REGISTRY: Record<string, () => Promise<Adapter>> = {
	scraperapi: () => import('./scraperapi/index.js').then((m) => m.ScraperapiAdapter),
	scrapingbee: () => import('./scrapingbee/index.js').then((m) => m.ScrapingbeeAdapter),
	scrapfly: () => import('./scrapfly/index.js').then((m) => m.ScrapflyAdapter),
	brightdata: () => import('./brightdata/index.js').then((m) => m.BrightdataAdapter),
};
