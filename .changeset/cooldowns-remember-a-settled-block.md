---
'@proxlane/gateway': minor
'@proxlane/shared': minor
---

A block cooldown that keeps failing now backs off to 6 hours instead of re-arming at a flat 15
minutes forever. A (provider, domain) that had refused a hundred times running cost 96 paid
probes a day, 288 for a domain three providers block, all of it re-buying evidence already
held. Account cooldowns are unchanged: a rate limit resets on its own and is private to one org.

Because a fully-blocked domain would otherwise go dark for the whole backoff, an all-cooling
domain now gets one forced attempt, rate-limited per domain and reported as
`X-Provider-Health: cooling-forced`.
