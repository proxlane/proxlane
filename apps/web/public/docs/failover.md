<!-- Source: https://proxlane.dev/docs/failover — edit apps/web/content/docs/failover.md -->
---
title: How failover works
summary: What Proxlane does between your request and the page you get back.
---

Most of the time you do not need this page. Read it when a result surprises you, or before
you tune anything.

## The chain

Proxlane picks the providers that can serve your request, orders them, and tries them one at
a time until one succeeds or the list runs out.

A provider only enters the chain if it can do what you asked. Request `render=true` and
providers without JavaScript rendering are excluded before anything is tried.

Order comes from configuration, not the alphabet. `PROXLANE_PROVIDER_ORDER` sets it.
Anything you leave out keeps a stable position behind the providers you name.

## When Proxlane moves on

Each outcome decides whether the chain continues. The rules live in one table, never in an
adapter, so every provider behaves the same way.

- **Provider failed.** 5xx, a timeout, a rate limit, a bad key. Try the next one.
- **Blocked.** The page came back but the detector recognised a block page. Try the next one.
- **The target answered.** A 404 or a 403 from the site itself is a real answer. Stop.
- **Your request is wrong.** A malformed URL or a denylisted host. Stop.

The third rule matters most. A 404 is not a failure to route around. Retrying it across three
providers costs three times as much and returns the same 404.

## Detection

A blocked request usually returns HTTP 200 with a challenge page in the body. Status codes
alone cannot see it, which is why Proxlane reads the body.

When a rule matches, the outcome is `SOFT_BLOCK` and `X-Detect-Rule` names the rule. You get
the reason, not just the verdict.

Rules currently come from vendor signatures. They have not yet been tuned against a corpus
of real block pages, so treat detection as good but not finished.

## Cooldowns

A provider that just refused a domain is skipped for a short window rather than paid to
refuse again.

Cooldowns are scoped, and the scope is the point:

- **Domain cooldowns** are shared. A block is a fact about the site, so it is worth knowing
  across the board.
- **Account cooldowns** are private to one deployment. An expired key is a fact about your
  account and must never affect anyone else.

`GET /health/cooldowns` shows what is cooling and what recently expired. Cooldowns are on by
default.

## Deadlines

Your request gets one global deadline. Each attempt gets a slice of it, sized to leave room
for the attempts that follow.

That is why a failover chain never outlives the client waiting on it. If the deadline runs
out, the outcome is `BUDGET_EXCEEDED`.

## Provider health

Proxlane can also keep a running opinion of each provider and route around one that is
degrading.

**This is off by default.** The statistic assumes failures arrive independently, and real
providers have bad hours instead. In simulation, a provider with a perfectly ordinary 5%
average failure rate spends over 90% of its time demoted, because the failures clump.

Turn it on with `PROXLANE_HEALTH=on` and watch `GET /health/providers`. Leave it off until
you have traffic you can check it against.

Cooldowns are separate and stay on. They react to something a provider just did, not to a
prediction.

## What you are charged for

Every attempt, including the ones that failed.

`X-Cost-Estimate` reports the total across the chain. A failover that burned two charged
hops reports two. Reporting only the successful hop would understate what a retry costs, and
the cost of retries is the thing worth watching.
