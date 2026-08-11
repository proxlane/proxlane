---
'@proxlane/gateway': patch
'@proxlane/shared': patch
---

Security follow-ups: hostnames in cooldown keys are bounded to 253 characters, a trailing FQDN dot no longer creates a second key for the same site, the gateway key comparison uses `timingSafeEqual` rather than a length-short-circuiting loop, and `PROXLANE_ORG_ID` actually reaches the chain so `cd:acct` is namespaced per deployment.
