---
'@proxlane/shared': minor
'@proxlane/adapters': minor
'@proxlane/gateway': minor
---

A Scrapfly response over 5MB no longer arrives as a URL marked `OK`. Scrapfly offloads bodies above that size to an object store and returns a pointer; `parse()` read it as the page, so the caller got 70 bytes with HTTP 200, the target's content-type and a charge. It is now `PROVIDER_BODY_OFFLOADED`, which fails over to a provider that returns the body inline.
