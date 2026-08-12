---
'@proxlane/gateway': minor
---

The provider order is now an explicit, operator-overridable list (`PROXLANE_PROVIDER_ORDER`) rather than `Object.keys(REGISTRY).sort()` — which was alphabetical, chosen by nobody, and decided which provider got paid first on every request.
