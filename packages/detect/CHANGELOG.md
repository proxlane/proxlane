# @proxlane/detect

## 0.1.0

### Minor Changes

- b1f13d2: The block detector: `detect(bytes, contentType, charset)` returns the vendor rule that fired, or nothing. Six rules covering Cloudflare, DataDome, PerimeterX, Imperva and Akamai, each anchored to a vendor asset path rather than generic words like "captcha" — a false positive here fails over and spends a second provider's credits.

### Patch Changes

- 25ba49b: Documents a limitation with a real capture: a site that serves its own block page — no Cloudflare, DataDome or Imperva markup — returns 200 with nothing to fingerprint, and the detector calls it `OK`. A rule matching the words would flag any article about bot detection, so catching it needs a per-domain baseline rather than a string match.
