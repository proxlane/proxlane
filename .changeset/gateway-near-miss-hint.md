---
"@proxlane/gateway": minor
"@proxlane/web": patch
---

When an ignored query parameter is one character off one the gateway reads, or another provider's spelling of one, the new `X-Ignored-Params-Hint` header names the parameter it probably meant, for example `providers=provider`; the request log records how many parameters were ignored and the near misses, never the other names.
