---
'@proxlane/web': minor
'@proxlane/adapters': patch
'@proxlane/shared': minor
---

A scraping API comparison at `/scraping-api-comparison`: pick a request shape and see what each
provider charges on top of its own base rate, from their published tables. Compares multipliers,
which are dimensionless, and never compares base rates across billing units. Fixes Bright Data's
base cost, which was a hundred times too low — the only provider whose cost we estimate rather
than read off the response. `@proxlane/shared` gains an `./error-body` subpath so `@proxlane/adapters`
no longer drags `node:crypto` into anything that imports it.
