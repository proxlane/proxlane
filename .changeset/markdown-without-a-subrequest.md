---
'@proxlane/web': patch
---

Markdown negotiation returned 500 in production. The middleware answered by fetching the page's
`.md` twin from its own origin, which works under `vite preview` and does not work from a
Cloudflare Worker: the subrequest never reaches the asset layer, so it fell through to Start's
router, and Start answers a non-HTML `Accept` with `500 Only HTML requests are supported here`.

The markdown is inlined at build time now, from the same generated artifacts `/docs/<slug>.md`
serves, so the two routes cannot drift. A page with no published twin answers 406 rather than
falling through, because falling through is what produced the 500.

Verified under `wrangler dev`, which runs workerd, rather than under the preview server that
missed it the first time.
