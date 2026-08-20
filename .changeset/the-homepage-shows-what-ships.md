---
'@proxlane/gateway': patch
'@proxlane/web': minor
---

`X-Chain` is omitted rather than sent empty when no provider was tried. A request refused before
the chain starts has no attempts, so 0.7.0 emitted a bare `X-Chain:` — `X-Provider-Used` already
follows "omitted, never empty" for the same reason.

The homepage transcript matches the gateway again: the boot banner listed the providers in the
wrong order and carried no version, and the response was missing `x-chain` and `x-cost-unit`. The
order now derives from the capability table on the same page. The social card is redrawn from an
SVG source, having spent six days showing a retired wordmark and claiming three providers.
