<!-- Source: https://proxlane.dev/docs/providers — edit apps/web/content/docs/providers.md -->
---
title: Getting provider keys
summary: Which provider to start with, where to get a key, and what to set.
---

Proxlane has no account system and resells nothing. Requests run on **your** provider accounts,
so before the gateway can do anything you need at least one provider key. One is enough; a
second is what gives failover somewhere to go.

All four offer a free trial, so you can see whether Proxlane fits before paying anyone. The
sizes differ and change often; each provider's pricing page is the authority.

*Some links on this page are referral links. If you create a provider account through one,
Proxlane may earn a commission, at no extra cost to you. It changes nothing about how requests
are routed, how providers are measured, or what gets published.*

## The four, alphabetically

Listed A to Z, not best to worst. Which one is best depends on your targets, and the honest
answer is that you find out by running them. The measured comparison is not published yet,
because there is not enough traffic behind it to be worth trusting.

### Bright Data

[brightdata.com](https://brightdata.com) — the Web Unlocker product.

The cheapest of the four for rendered pages: rendering is included rather than a multiplier.
The key has a shape the others do not, `<zone>:<token>`, because the zone is a property of
your account. A bare token reads as an empty zone and comes back as `AUTH_FAILED`.

```bash
BRIGHTDATA_KEY=my-unlocker-zone:abc123...
```

### ScraperAPI

[scraperapi.com](https://www.scraperapi.com) — the widest set of options.

The only one of the four that keeps a session across requests (`sessionId`), and it sells
residential and stealth tiers. Rendering costs ten times a plain request. Binary responses come
back decoded, so Proxlane does not route images or PDFs here.

```bash
SCRAPERAPI_KEY=abc123...
```

### ScrapingBee

[scrapingbee.com](https://www.scrapingbee.com) — the simplest API of the four.

Rendering costs five times a plain request. Geotargeting covers a published list of regions
rather than everywhere, and the countries available depend on your plan.

```bash
SCRAPINGBEE_KEY=abc123...
```

### Scrapfly

[scrapfly.io](https://scrapfly.io) — the most detailed cost reporting.

Every response carries what it actually cost, so `X-Cost` from Proxlane is the provider's own
number rather than an estimate. Rendering costs six times a plain request. Bodies over about
5 MB are offloaded to a URL, which Proxlane treats as a failure to fail over from rather than
handing you a link where a page should be.

```bash
SCRAPFLY_KEY=abc123...
```

## Which to start with

- **Cheapest for rendered pages:** Bright Data, where rendering is not a multiplier.
- **Most options:** ScraperAPI, if you need sessions or a residential tier.
- **Exact costs per request:** Scrapfly.
- **Fewest decisions:** ScrapingBee.

## Setting the key

Pass it as an environment variable, the same way [Quickstart](/docs/quickstart) does:

```bash
docker run -p 8787:8787 \
  -e PROXLANE_API_KEY="$(openssl rand -hex 32)" \
  -e SCRAPERAPI_KEY=... \
  -e BRIGHTDATA_KEY=... \
  ghcr.io/proxlane/gateway:latest
```

Providers you set no key for are left out of the chain entirely. Nothing fails, and nothing is
logged about them; they are simply not candidates.

Run `proxlane doctor` to check what the gateway can see. It reports which keys are set, whether
the Bright Data key has the right shape, and what will happen if none are.

## Where your keys go

Into the gateway process you run, and to the provider named on each request. Proxlane has no
server of its own to send them to. Self-hosted means the whole path is yours: the container,
the keys, the logs, and whatever the provider bills you.
