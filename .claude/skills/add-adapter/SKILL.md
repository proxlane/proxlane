---
name: add-adapter
description: Write a new provider adapter for Proxlane. Use when adding support for a scraping API (ScraperAPI, ScrapingBee, Scrapfly, Zyte, Bright Data, …), or when an existing adapter needs re-recording after provider drift.
---

# Adding an adapter

Read `docs/integrations.md` sections 2, 3 and 6 first. This skill is the loop, not the spec.

## You do not need provider API keys

Contract tests replay recorded fixtures. You can write an adapter and get `pnpm conformance`
green with nothing but Node, pnpm and Docker.

The one check that needs real keys is the live canary, and it **cannot** run on a fork PR at
all — GitHub does not expose secrets to forks. A maintainer runs it on house keys before
merge. **A skipped canary on your PR is expected, not a failure**, and it is not something
you can or should try to fix.

## The loop is serial. Do not parallelise it

```
contract.ts compiles  →  pnpm new-adapter <id>  →  pnpm record --adapter=<id>
                      →  implement translate/parse  →  pnpm conformance --adapter=<id>
```

Each step's output is the next step's input. `pnpm repo:check` tells you which step you are
on: every command in the chain is a manifest entry, and a red one names its own owner, spec
and blocking file.

## Step by step

**1. `pnpm new-adapter <id>`** scaffolds capabilities, `translate`/`parse` stubs, the Zod
response schema, a fixture directory and conformance registration.

**2. `pnpm record --adapter=<id>`** hits the real API with a trial key against stable targets
and sanitizes secrets before writing.

> **Never hand-write a fixture.** CI cannot tell a recording from a fabrication — that check
> does not exist and cannot be built. This one is on you. A fabricated fixture makes the
> whole contract layer decorative.

Fixtures are **post-transfer-decoding, pre-charset-decoding bytes plus all response
headers**. undici already decompressed `content-encoding`; charset decoding has not happened
yet. If you are looking at a string, something is wrong.

**3. Implement `translate` and `parse`. Both are pure functions.**

- All I/O goes through the shared `HttpTransport`. An adapter that opens a socket has broken
  the property the entire test strategy rests on.
- `latencyMs` and `providerRequestId` live on `Exchange`, not on `ParsedResult` — a pure
  function cannot measure elapsed time. If you find yourself wanting a clock in `parse`,
  stop.
- **Set every parameter explicitly.** Provider defaults must never leak. This is a house
  rule because a default that changes upstream becomes a silent behaviour change here.
- Parse the response with the Zod schema. Never `as`-cast a provider payload — a parse
  failure is `PROVIDER_DRIFT`, which is signal, and a cast is that signal discarded.

**4. `pnpm conformance --adapter=<id>`** until green. It checks that every `GatewayRequest`
permutation translates without leaking defaults, every fixture category parses to the right
outcome, and declared capabilities are honest.

**5. Cost table** with a source link and an effective date, in microcredits.

## Outcomes are central, never per-adapter

Failover behaviour is defined once, per outcome, in `integrations.md` section 3. An adapter
maps a provider response to an outcome and stops there. If you are writing retry logic
inside an adapter, the outcome taxonomy is missing a case — raise that instead.

## Before you open the PR

- `pnpm conformance --adapter=<id>` green
- A changeset (`pnpm changeset`) — a new adapter is a `minor`
- Docs updated in the same PR if the public surface moved
- No secrets in fixtures. The recorder sanitizes; CI scans; you check anyway
