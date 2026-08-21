---
'@proxlane/detect': patch
---

`akamai-bot-manager` now matches Akamai's real deny page, whose signature is HTML-entity-encoded
so the previous literal could never fire on it. Four of six detection rules are now confirmed
against a real captured block page, up from zero.
