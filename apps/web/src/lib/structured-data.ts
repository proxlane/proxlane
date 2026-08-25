/**
 * The JSON-LD identity block, kept out of the route so it can be asserted.
 *
 * Inline in `__root.tsx` it was a `JSON.stringify` of an object literal inside a head config —
 * unreachable from a test without rendering the whole document, which is how a malformed
 * identity block ships and nobody notices until a crawler quietly ignores it.
 */

export const SITE = 'https://proxlane.dev';

/**
 * `SoftwareApplication`, and deliberately NOT `Organization`.
 *
 * An Organization block is only worth anything with `contactPoint` and `address` on it, and
 * there is no company here to describe — filling those in would mean publishing a personal
 * postal address and phone number to satisfy a checklist. What is true is that this is a
 * developer tool with a licence, a repository and a price, which is what this says.
 *
 * `price: '0'` is not a marketing claim. BYOK and self-host are the two launch modes, both
 * free forever, and there is no hosted endpoint to charge for. Stating it here means an agent
 * does not have to infer it from a pricing table it would otherwise need to read and parse.
 */
export function softwareApplicationLd(description: string): Record<string, unknown> {
	return {
		'@context': 'https://schema.org',
		'@type': 'SoftwareApplication',
		name: 'Proxlane',
		url: `${SITE}/`,
		description,
		applicationCategory: 'DeveloperApplication',
		operatingSystem: 'Docker, Linux, macOS',
		license: 'https://www.gnu.org/licenses/agpl-3.0.html',
		softwareHelp: `${SITE}/docs`,
		codeRepository: 'https://github.com/proxlane/proxlane',
		offers: {
			'@type': 'Offer',
			price: '0',
			priceCurrency: 'EUR',
			description:
				'Bring your own provider keys, or self-host. Both are free; there is no hosted endpoint and no account.',
		},
	};
}
