---
'@proxlane/shared': patch
---

The gateway now routes on provider health: the chain is re-ranked by state, demoted providers are dropped, the least-bad one is forced rather than refusing, and the result is reported on `X-Provider-Health` and `GET /health/providers`.
