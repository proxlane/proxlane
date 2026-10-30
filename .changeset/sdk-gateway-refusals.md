---
"@proxlane/sdk": patch
---

`fetch_page` passes on the gateway's own reason when it refuses a key or token, and marks a per-caller limit retryable with how long to wait.
