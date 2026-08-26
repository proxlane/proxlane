---
'@proxlane/adapters': patch
---

The live canary's JavaScript-render check now scrapes a page this project serves, not a
third-party scraping-demo site. That target failed twice in one morning on two different
providers while answering in half a second from a laptop, and the launch gate counts three
consecutive *scheduled* greens with no way for a manual re-dispatch to repair a red one.

The new marker is absent from the served HTML — the page assembles it from two halves at runtime
— so a provider returning the unrendered document cannot satisfy the assertion by accident. The
old marker was plain text in the source that the page also rendered, so it could.

Verified live against all three providers before landing: OK with the marker present on each, at
the exact cost the table predicts.
