---
title: Getting provider keys
summary: Which provider to start with, where to get a key, and what to set.
---

Proxlane has no accounts of its own. Requests run on your provider accounts, so you need at
least one provider key before the gateway can do anything. One is enough. A second one gives
failover somewhere to go.

All five have a free trial. The sizes differ and change often, so check the pricing pages.

*Some links on this page are referral links. If you create a provider account through one,
Proxlane may earn a commission, at no extra cost to you. It changes nothing about how requests
are routed, how providers are measured, or what gets published.*

## The five providers

Listed alphabetically. Which one works best depends on your targets, and the only way to know
is to run them. A measured comparison will be published once there is enough traffic behind it.

### Bright Data

[brightdata.com](https://brightdata.com), the Web Unlocker product.

Rendering is included in the price, so this is the cheapest of the four for rendered pages.
The key is `<zone>:<token>`, because the zone belongs to your account. A bare token is read as
an empty zone and comes back as `AUTH_FAILED`.

```bash
BRIGHTDATA_KEY=my-unlocker-zone:abc123...
```

### Firecrawl

[firecrawl.dev](https://www.firecrawl.dev), built for feeding pages to LLMs.

One credit per page whether or not it renders, which makes it the cheapest of the five for
rendered pages alongside Bright Data. Proxlane asks it for the raw page bytes, not the
markdown it is known for. It has no residential tier and cannot forward a POST. Its free plan
is 1,000 credits a month.

```bash
FIRECRAWL_KEY=fc-abc123...
```

### ScraperAPI

[scraperapi.com](https://www.scraperapi.com), the one with the most options.

It is the only one of the five that keeps a session across requests (`sessionId`), and it sells
residential and stealth tiers. Rendering costs ten times a plain request. Binary responses come
back decoded, so Proxlane does not send images or PDFs here.

```bash
SCRAPERAPI_KEY=abc123...
```

### ScrapingBee

[scrapingbee.com](https://www.scrapingbee.com), the simplest API of the five.

Rendering costs five times a plain request. Geotargeting covers a fixed list of regions, and
which countries you get depends on your plan.

```bash
SCRAPINGBEE_KEY=abc123...
```

### Scrapfly

[scrapfly.io](https://scrapfly.io), the one with exact cost reporting.

Every response says what it cost, so `X-Cost` from Proxlane is Scrapfly's own number, not an
estimate. Rendering costs six times a plain request. Bodies over about 5 MB come back as a
URL instead of a page; Proxlane treats that as a failure and moves to the next provider.

```bash
SCRAPFLY_KEY=abc123...
```

## Which to start with

If you render a lot of pages, Bright Data and Firecrawl are the cheapest. If you need sessions or a
residential tier, ScraperAPI. If you want the exact cost of every request, Scrapfly. If you
want the fewest decisions, ScrapingBee.

## Setting the key

Pass it as an environment variable, the same way [Quickstart](/docs/quickstart) does:

```bash
docker run -p 8787:8787 \
  -e PROXLANE_API_KEY="$(openssl rand -hex 32)" \
  -e SCRAPERAPI_KEY=... \
  -e BRIGHTDATA_KEY=... \
  ghcr.io/proxlane/gateway:latest
```

Providers with no key are left out of the chain. Nothing fails and nothing is logged about
them.

Run `proxlane doctor` to see what the gateway sees: which keys are set, whether the Bright
Data key has the right shape, and what happens if none are set.

## Where your keys go

To the gateway you run, and from there to the provider named on each request. Proxlane has
no server of its own. The container, the keys, the logs and the provider bill are all yours.
