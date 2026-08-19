---
'@proxlane/adapters': minor
'@proxlane/shared': minor
'@proxlane/gateway': minor
---

Returning a body byte for byte is now a declared capability, and `binary=true` a request
parameter. An image request used to return 200 with a corrupted body; it now routes only to
providers that can carry bytes, or answers `NO_PROVIDER_AVAILABLE`. Three of the four launch
providers carry binary. ScraperAPI does not — it decodes bodies as UTF-8, and its own API says
so: `binary_target=true` answers 400, "The file type you are trying to scrape is not supported."
