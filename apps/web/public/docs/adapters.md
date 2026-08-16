<!-- Source: https://proxlane.dev/docs/adapters — edit apps/web/content/docs/adapters.md -->
---
title: Bring your own provider
summary: Add a provider Proxlane has never heard of, and it joins the chain.
---

Proxlane ships three providers. It is not limited to them.

An adapter is two pure functions and a table of what the provider can do. Write one and that
provider joins the chain with failover, cooldowns, cost reporting and block detection already
attached. You do not implement any of that. It is the gateway's job.

## Why the licence lets you

The adapter, detection, SDK and shared packages are **Apache-2.0**, deliberately, while the
gateway is AGPL. That split exists for exactly this: you can write an adapter, keep it
private, and ship it inside a closed product without inheriting copyleft.

Adapters are the part of this project most worth a stranger's contribution, and a copyleft
adapter layer would have been a tax on the one thing we most want to happen.

## What an adapter is

```bash
pnpm new-adapter acmescrape
```

```
  scaffolded packages/adapters/src/acmescrape/

    capabilities.ts    what the provider can do. Data, not code
    schema.ts          Zod envelope; a parse failure is PROVIDER_DRIFT
    index.ts           translate + parse, both throwing until implemented
    fixtures/          empty until you record

  registered in packages/adapters/src/registry.ts
```

Four files, and only one of them has logic in it.

### capabilities.ts

Data. Which countries, which proxy tiers, whether it renders JavaScript, whether it does
sessions and POST, its per-attempt timeouts, and a cost table with a source link and an
effective date.

The router reads this before it reads anything else. Ask for `render=true` and providers that
cannot render are excluded before a request is built, so an adapter that declares itself
honestly is never asked to do something it cannot.

### translate

Turn a `GatewayRequest` into an HTTP request for your provider. Pure, and it must set **every
parameter explicitly**.

That rule is not style. A provider default that changes under you becomes a silent behaviour
change in production, and one that costs money: `render` defaults differ between providers and
a rendered request is often five to ten times the price.

### parse

Turn the provider's HTTP response into an outcome. Pure, and it must parse with a Zod schema
rather than cast. A response that does not match the schema is `PROVIDER_DRIFT`, which is the
one outcome that pages a human, because it means the provider changed their contract.

`parse` can never return `SOFT_BLOCK`. Detection is one shared step outside adapters, run by
the gateway on the bytes you return. A pure function has not seen the detector and cannot know
a rule fired.

## What you get for free

Everything the gateway does, it does for your adapter too:

- **Failover.** Your provider is one hop in a chain. Its failures move to the next one.
- **Cooldowns.** A provider that just refused a domain is skipped rather than paid to refuse
  again.
- **Detection.** Your bytes go through the same block-page rules as everyone's.
- **Cost reporting.** Your cost table feeds `X-Cost-Estimate`, summed across attempts.
- **Backpressure, deadlines, the body cap, the edge guard.** All of it.
- **A line colour.** Declared once in your capabilities and reused by every surface that draws
  a route.

## The authoring loop

```bash
pnpm new-adapter acmescrape
pnpm record --adapter=acmescrape     # real traffic, sanitised, into fixtures/
pnpm conformance --adapter=acmescrape
```

`conformance` is a shared suite every adapter runs. It replays your recorded fixtures against
your `translate` and `parse` and holds them to the same contract as the three that ship.

**Never hand-write a fixture.** CI cannot tell a recording from a fabrication, so this one is
on you. A fabricated fixture makes a contract test assert against fiction, which is worse than
having no test.

You do **not** need our provider keys to contribute to Proxlane itself: the contract tests
replay recorded fixtures, so a clone, Node, pnpm and Docker are enough to run the whole suite.
You do need a key for the provider you are adding, because recording its traffic is the point.

## Keeping it private

Nothing requires you to upstream it. The scaffold writes into `packages/adapters/src/` and
registers itself, and an Apache-2.0 package can be vendored into a closed codebase.

If you do want to upstream it, adapters are the contribution most likely to be merged quickly.

## What this does not do

It does not give you a provider you have not paid for. An adapter is a translation layer for
an account you hold. Proxlane routes to providers, it is not one.
