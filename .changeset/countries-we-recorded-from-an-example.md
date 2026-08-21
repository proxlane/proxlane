---
'@proxlane/adapters': patch
---

ScrapingBee's country list goes from 7 codes to the 42 it actually sells on classic proxies. The
seven were an example table in their docs, and the router filters the failover chain on this set,
so the provider was silently ineligible for thirty-five countries. `ru` leaves: it is premium-only,
and classic silently serves `us` instead of erroring. Adds `CAPABILITIES`, a static export of every
adapter's capabilities that does not load the adapters, and cross-provider assertions over it.
