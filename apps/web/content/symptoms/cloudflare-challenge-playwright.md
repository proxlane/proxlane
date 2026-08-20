---
title: Cloudflare challenge page in Playwright
summary: What rendering JavaScript changes about a Cloudflare interstitial, and what it doesn't.
query: playwright still gets the cloudflare challenge page
---

Rendering the page with a headless browser does not make Cloudflare's challenge go away.
Cloudflare's interstitial is designed to run in a real browser; passing it is a separate
problem from running JavaScript at all, and the two get confused constantly.

**Proxlane does not run Playwright and does not solve challenges itself.** It is a proxy
gateway in front of scraping APIs that do their own headless rendering. What it adds is
telling you, reliably, whether the challenge got solved or you're looking at the interstitial
page.

## What render=true actually does

`render=true` asks the provider to load the page in a real browser rather than fetch raw
HTML. It routes only to providers that support JS rendering, and it costs more, typically
several times a plain fetch, because it is.

It is not a captcha-solving switch. A provider can render the page fully and Cloudflare can
still recognize the automation and serve the interstitial anyway. Rendering and passing
Cloudflare's check are different things that happen to often go together.

## How to tell you got the interstitial, not the page

Cloudflare's challenge injects a recognizable script path. Proxlane's detector looks for it
in the response body and marks the outcome `SOFT_BLOCK` rather than `OK`, even though the
provider returned 200:

```
X-Outcome: SOFT_BLOCK
X-Outcome-Class: blocked
X-Detect-Rule: cloudflare-challenge
```

A Cloudflare 1020 or an error page (rather than the interactive challenge) matches a
separate rule:

```
X-Detect-Rule: cloudflare-blocked
```

Both rules are written from Cloudflare's publicly observable markup and have not been
confirmed against a real captured challenge. That is worth saying plainly on a page that
tells you to trust a header: it is a documented hypothesis rather than tested folklore. If
you have a real capture, the corpus lives in `packages/detect`.

Either way, `X-Outcome-Class: blocked` already triggered failover to the next provider in
the chain before you saw this response. If it's still what you get back, every available
provider hit the same wall on that domain just now.

```bash
curl -s "https://your-gateway/v1?api_key=$KEY&url=https://example.com&render=true" \
  -D - -o /dev/null | grep -i '^x-'
```

## What actually changes the outcome

Two things are the documented levers, and both are honest to state as levers rather than
guarantees:

- **A different provider.** Providers vary in how they render and route traffic, and one
  succeeding where another didn't is exactly what failover is for. Proxlane tries the next
  provider automatically; you don't write that logic.
- **`premium=residential` or `premium=stealth`.** Routes through a different proxy tier.
  Whether that changes the outcome against a specific site's Cloudflare configuration is not
  something this page can promise, because it depends on that site's rules, which Proxlane
  has no visibility into and does not measure per target.

No number belongs on this page for "how often this works," because that would be a benchmark
without a target-independent method behind it, and Cloudflare's own decision is the actual
variable.

## If you're not going through a provider at all

If you're running Playwright directly against a Cloudflare-protected page with no scraping
API in between, Proxlane doesn't apply until you route through a provider. It has nothing to
add to a raw Playwright script. `render=true` through a provider that does its own challenge
handling is the path this product covers.

## Related

- [Outcomes reference](/docs/outcomes): the `blocked` class and what triggers it.
- [Using Proxlane from an agent](/docs/agents): branching on `X-Outcome-Class` in a loop
  that renders and retries automatically.
