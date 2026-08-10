---
'@proxlane/detect': minor
---

The block detector: `detect(bytes, contentType, charset)` returns the vendor rule that fired, or nothing. Six rules covering Cloudflare, DataDome, PerimeterX, Imperva and Akamai, each anchored to a vendor asset path rather than generic words like "captcha" — a false positive here fails over and spends a second provider's credits.
