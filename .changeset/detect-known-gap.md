---
'@proxlane/detect': patch
---

Documents a limitation with a real capture: a site that serves its own block page — no Cloudflare, DataDome or Imperva markup — returns 200 with nothing to fingerprint, and the detector calls it `OK`. A rule matching the words would flag any article about bot detection, so catching it needs a per-domain baseline rather than a string match.
