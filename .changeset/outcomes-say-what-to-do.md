---
'@proxlane/shared': minor
'@proxlane/adapters': minor
'proxlane': minor
'@proxlane/gateway': patch
---

`proxlane outcomes` now says what to do about an outcome, not only what it means: an `action`, a
sentence of why, and a link to the class's docs section. The policy fields describe what the
gateway does internally — `failover: true` on a blocked outcome means every provider was already
tried — which is the opposite of what a caller reading it as "retryable" would conclude.

Error responses and the CLI both link to `proxlane.dev/docs/outcomes`, which is live. They
pointed at GitHub because `docs.proxlane.dev` has no DNS record; it was the subdomain that never
existed, not the docs.
