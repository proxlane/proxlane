---
'@proxlane/adapters': minor
'@proxlane/shared': minor
'@proxlane/gateway': minor
---

Returning a body byte for byte is now a declared capability, and `binary=true` a request
parameter. Measured: two of the four launch providers destroy binary — ScraperAPI decodes bodies
as UTF-8, Scrapfly wraps them in a JSON envelope — so an image request used to return 200 with a
corrupted body. It now routes only to providers that can carry bytes, or answers
`NO_PROVIDER_AVAILABLE`.
