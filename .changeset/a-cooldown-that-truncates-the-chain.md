---
'@proxlane/gateway': minor
---

A cooldown no longer truncates the chain. When every provider the walk tried has failed, one
cooled provider is attempted before giving up — the same single per-domain slot the existing floor
uses. Previously a chain whose best provider happened to be cooling could fail on all the others
and return a provider fault having never tried the one that would have worked.
