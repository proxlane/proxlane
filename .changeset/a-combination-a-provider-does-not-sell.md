---
'@proxlane/adapters': minor
'@proxlane/gateway': minor
'proxlane': patch
---

Capabilities can now describe a combination a provider refuses even though it offers each part
alone. ScraperAPI's sessions and premium proxies are mutually exclusive by their own
documentation, and the router used to send requests asking for both. Declared as data rather than
a predicate, so `proxlane providers` prints it.
