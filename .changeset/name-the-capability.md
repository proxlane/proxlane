---
'@proxlane/gateway': minor
---

`NO_PROVIDER_AVAILABLE` now says which capability excluded each provider instead of "no configured provider has the requested capabilities", a sentence true of every cause and actionable for none. A caller who added `wait_for` to a working request got a 4ms refusal with nothing connecting it to the parameter they had just added; the reason now reads `no configured provider can serve this request: brightdata (wait_for), scraperapi (country_code=jp)`. It is per provider because they rarely drop out for the same reason. `isCapable` is now derived from the function that answers why, so the explanation cannot drift from the routing.
