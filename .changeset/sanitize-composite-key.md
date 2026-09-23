---
"@proxlane/adapters": patch
---

The recorder now redacts each component of a composite provider key, not only the whole string. Bright Data's key is a zone and a token joined by a colon, and the adapter sends the zone as its own field, so the zone was reaching fixtures in cleartext.
