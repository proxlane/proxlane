---
'@proxlane/adapters': minor
---

A host that does not resolve is now `TARGET_ERROR` from every provider. Scrapfly reported it
as `INVALID_REQUEST`, which paged a human and stopped the chain; Bright Data as
`PROVIDER_ERROR`, which cooled a healthy provider. Conformance now asserts the recorded
outcome for the new `dead-host` fixture, which is what makes it stay fixed.
