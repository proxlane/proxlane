---
"@proxlane/adapters": patch
---

The recorder redacts request-path addresses a target echoes back, httpbin's `origin` and any forwarded-for header, and refuses to write a fixture that still carries one; four fixtures are re-recorded without them.
