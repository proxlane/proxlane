---
"@proxlane/adapters": patch
---

The recorder redacts Scrapfly's per-request identifiers, the envelope's `uuid` and the `x-scrapfly-reject-id` header, as it already did Firecrawl's `scrapeId`.
