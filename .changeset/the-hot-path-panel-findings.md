---
'@proxlane/adapters': minor
'@proxlane/gateway': minor
---

A provider's own `Retry-After` now reaches the caller. `ParsedResult.retryAfterMs` had been in the
contract since it landed and the chain already armed cooldowns from it, but no adapter ever set
it — so a provider that capped us and said exactly how long to wait had that answer discarded, the
cooldown drew a 30s jittered guess, and the caller got a bare 429.

Two chain fixes: an answered request whose next candidate lost its probe claim kept only the
outcome name, dropping the provider, the body and the detect rule. And a throwing health store
could make the chain re-attempt — and re-pay for — a provider it had already tried.
