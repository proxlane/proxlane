/**
 * Every shipped adapter's capabilities, as data, without loading the adapters.
 *
 * `REGISTRY` maps an id to an async loader so the gateway pulls in only the adapters a request
 * actually needs. That is right for the hot path and wrong for everything that just wants to
 * KNOW what exists: `proxlane providers` awaits four full adapters, including their translate
 * and parse code, to print a table of fields that are static objects.
 *
 * Capabilities are static objects. They are what the router filters the chain on, what the CLI
 * prints, and what the site's cost comparison reads. This exports them directly.
 *
 * IT MUST NOT DRIFT FROM `REGISTRY`, and a test asserts the two hold exactly the same ids in
 * both directions. A second list of providers is the classic way to ship a provider that the
 * router has never heard of, or hide one it has.
 */

import { capabilities as brightdata } from './brightdata/capabilities.js';
import type { ProviderCapabilities } from './contract.js';
import { capabilities as scraperapi } from './scraperapi/capabilities.js';
import { capabilities as scrapfly } from './scrapfly/capabilities.js';
import { capabilities as scrapingbee } from './scrapingbee/capabilities.js';

/** Sorted by `line`, which is the order the failover chain and the diagram both use. */
export const CAPABILITIES: readonly ProviderCapabilities[] = [
	scraperapi,
	scrapingbee,
	scrapfly,
	brightdata,
].sort((a, b) => a.line - b.line);

/** One provider's capabilities, or undefined. */
export function capabilitiesFor(id: string): ProviderCapabilities | undefined {
	return CAPABILITIES.find((c) => c.id === id);
}
