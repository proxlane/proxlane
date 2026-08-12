---
"@proxlane/shared": minor
"@proxlane/adapters": minor
"@proxlane/gateway": minor
---

**Breaking:** every non-2xx now returns one envelope — `{requestId, error: {code, class, message, docs}, attempts?}` — instead of `{error, message}` for auth and validation and `{outcome, class, attempts}` for a failed scrape. Response headers are unchanged.
