---
'@proxlane/adapters': patch
---

Scrapfly now pins `os` instead of letting Scrapfly choose. ScraperAPI and ScrapingBee were both
pinned to desktop, so the same request fetched a pinned desktop page on two providers and a
provider-chosen one on the third — visible to the caller only as `X-Provider-Used` changing, on
a gateway whose claim is that failover is invisible. It was always a leak; it got worse when
their changelog added `android`, `iphone` and `ipad` to the values `os` picks among, so the
unpinned set grew phones without anything changing on our side.

The per-adapter test named "sets every parameter explicitly" passed throughout, because the list
it iterates is hand-typed and therefore only covers the parameters somebody remembered. The
check is now cross-adapter and asserts its own completeness against the registry, so a fifth
adapter fails until somebody decides whether its API has a device parameter.
