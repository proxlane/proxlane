---
"@proxlane/adapters": patch
---

Scrapfly gains a recorded `quota-exhausted` fixture: a real response from an account whose plan ran out, which conformance now holds to `QUOTA_EXHAUSTED` rather than letting it pass as a provider error.
