---
"@proxlane/db": minor
---

The hand-written schema: `gateway_keys` (with `created_by`), `provider_keys`, `domain_stats`, and the weekly-partitioned `requests` and `request_attempts` in raw SQL. Adds partition rotation and detach-and-drop retention, both idempotent.
