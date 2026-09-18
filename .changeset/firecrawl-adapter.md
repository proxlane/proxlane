---
'@proxlane/adapters': minor
'@proxlane/ui': patch
'@proxlane/route-viz': patch
'@proxlane/web': patch
---

Firecrawl adapter: one credit per page, rendered or not, raw page bytes via `rawBase64`, 26 countries, no POST. New `targetStatus` capability, false for Firecrawl, says whether a provider reports the target's status on a failure; when it cannot, every target failure is `TARGET_ERROR` and the chain moves on. A fifth line colour for the route diagram comes with it.
