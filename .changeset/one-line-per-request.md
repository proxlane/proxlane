---
'@proxlane/gateway': minor
'proxlane': patch
---

One NDJSON line per `/v1` request, to stdout. The gateway logged nothing at all, so the moment it
was reachable by anyone there was no way to answer who probed it, which domains were scraped,
which provider served them, or what the outcome mix looked like. Records the target's host rather
than the URL, because query strings carry credentials. `PROXLANE_LOG=off` to silence it; `proxlane
doctor` reports which.
