---
"@proxlane/gateway": minor
---

Accept the gateway key as `Authorization: Bearer <key>` alongside `?api_key=`, and route POST on `/v1` with the request body capped by `maxBodyBytes`. The query parameter stays: it is the drop-in migration surface.
