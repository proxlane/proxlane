---
title: Use cases
summary: What Proxlane is good at, and what it is not for.
---

Proxlane is worth adding when you already scrape and the problem is reliability, cost or
visibility. It is not a scraper. It routes to the ones you already pay for.

## You already use a scraping API

The common starting point. One provider works until it does not, and you find out from a
customer rather than a dashboard.

Proxlane changes the failure from "the job returned garbage" to "provider A was blocked,
provider B served it, here is the rule that fired". Migration is a hostname change.

## You want a second provider without writing a second integration

Adding a fallback provider normally means a second client, a second set of parameters, a
second error shape, and a decision about when to switch.

Proxlane makes that one endpoint. Providers are configuration, not code. Add a key and the
new provider joins the chain.

## You cannot tell blocked from empty

The expensive failure in scraping is the silent one. A block page returns HTTP 200 with a
body, so anything checking status codes records a success and stores a challenge page.

Proxlane reads the body and calls it `SOFT_BLOCK`, with `X-Detect-Rule` naming the rule that
matched. Bad data stops entering your pipeline as though it were good.

## You are feeding a model

Retrieval pipelines are the worst place for a silent block, because the model will
confidently summarise whatever it is given.

Proxlane gives every fetch a verdict you can gate on. See
[using Proxlane from an agent](/docs/agents).

## You need to know what scraping actually costs

`X-Cost-Estimate` reports the spend across every attempt, including failed ones. A failover
that burned two charged hops reports two.

That is the number that tells you a target has become expensive, which usually happens well
before it starts failing outright.

## You have a compliance or data-residency requirement

Self-host it. The gateway is AGPL, runs in a container, and holds provider keys in its own
environment. Nothing is sent to us, because there is no us in the request path.

`country_code` selects where the request appears to come from, subject to provider coverage.

## What it is not for

**Not a scraper.** Proxlane does not parse HTML, manage crawl queues or schedule jobs. It
makes one request and returns one response.

**Not a proxy pool.** It routes to commercial scraping APIs. It does not manage IPs.

**Not a way to avoid paying providers.** It uses your keys and your credits, and it reports
what they cost.

**Not a bypass tool.** Detection tells you that you were blocked. It does not defeat the
block. What each provider does about anti-bot measures is between you and that provider,
under their terms.
