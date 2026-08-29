---
'@proxlane/shared': minor
'@proxlane/adapters': minor
'@proxlane/gateway': minor
---

`wait_for=<css selector>` tells the renderer what to wait for before it snapshots the page. Rendering means the renderer ran, not that the content arrived — on a late-hydrating page the same request returns the full listing on one attempt and an empty shell on the next, and until now nothing in the request could name the finish line. It implies `render=true`, and it narrows the chain to providers that can express it: ScrapingBee's `wait_for` and Scrapfly's `wait_for_selector` were verified live, ScraperAPI's is its published name and the canary confirms it, and Bright Data declares it cannot — `x-unblock-expect` is accepted there and could not be shown to enforce a wait, so it is filtered out rather than charging for a page that did not wait.
