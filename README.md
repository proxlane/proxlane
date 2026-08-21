# Proxlane

> **Pre-release, and self-host only.** Parts of this work and parts do not — the Status
> section below says which, and it is kept honest rather than aspirational. No packages are
> published yet, and **there is no hosted endpoint**: run it yourself, on your own provider
> keys. Docs are live at [proxlane.dev/docs](https://proxlane.dev/docs).
> Follow the repo if you want to know when that changes.

One lane to every scraping provider. Automatic failover, cost-aware routing, and
honest success detection.

Bring your own provider keys and it is free forever. Self-host it and it is free
forever. Use our hosted credits and you pay provider cost plus a flat 5%.

```diff
- https://api.scraperapi.com/?api_key=KEY&url=https://example.com
+ http://localhost:8787/v1?api_key=KEY&url=https://example.com
```

That is the migration. Same parameter names, same response, one hostname — and today that
hostname is your own, because the only way to run Proxlane is to run it yourself.

---

## Why

No single scraping provider works on every target. Teams end up with two or three
accounts and a pile of glue code that switches between them, retries the failures,
and guesses which one is cheapest for a given domain.

Proxlane is that glue code, extracted and made honest.

**Failover.** When a provider starts returning blocks at 2am, the request retries
through the next one. Providers will never fail over to their competitors. We will.

**Real success detection.** Providers return HTTP 200 with a CAPTCHA page in the
body. ScraperAPI documents this and asks users to report it. Proxlane runs every
response through a block detector before calling it a success, and tells you which
rule fired.

**Cost visibility across providers.** Your provider's dashboard shows you their
numbers. Proxlane shows you that a domain succeeds 98% of the time on provider A at
a third of what provider B charges for the same page.

**No lock-in.** Switching providers is a config change, not a code change.

### The reliability math

Suppose a hard target blocks 6% of requests on any given provider. One provider
gives you 94%. Three *independent* providers in a failover chain give you 99.98% on
the same target.

That independence assumption is the load-bearing part, and it is not true. Blocks are
caused by the target's anti-bot, which is a common cause: a page that fingerprints one
provider's traffic tends to fingerprint the next one's too. Real combined success will
land below the independent-product bound, by an amount nobody has measured yet.

So take the arithmetic as illustrative of the shape, not as a claim. The number we will
publish is the measured one, per domain, on `/targets` — which is the only version worth
publishing anyway.

---

## Quickstart

Two commands, and the first one is the gateway. There is no hosted endpoint to curl — the
`localhost` below is not standing in for one, it is where Proxlane runs.

```bash
docker run -p 8787:8787 \
  -e PROXLANE_API_KEY=$PROXLANE_API_KEY \
  -e SCRAPERAPI_KEY=$SCRAPERAPI_KEY \
  ghcr.io/proxlane/gateway
```

```bash
curl "http://localhost:8787/v1?api_key=$PROXLANE_API_KEY&url=https://example.com"
```

One provider key is enough to start. Add a second and failover has somewhere to go.

JavaScript rendering and geotargeting:

```bash
curl "http://localhost:8787/v1?api_key=$PROXLANE_API_KEY\
&url=https://example.com&render=true&country_code=de"
```

Every response tells you what happened:

```
X-Provider-Used: scrapingbee
X-Attempts: 2
X-Outcome: OK
X-Detect-Rule: none
X-Cost-Estimate: 0.00049
```

Node:

```js
const res = await fetch(
  `http://localhost:8787/v1?api_key=${key}&url=${encodeURIComponent(target)}`
);
const html = await res.text();
```

Full parameter reference: [proxlane.dev/docs/api](https://proxlane.dev/docs/api). Every
outcome, and what to do about each: [proxlane.dev/docs/outcomes](https://proxlane.dev/docs/outcomes).

## Self-hosting

```bash
git clone https://github.com/proxlane/proxlane
cd proxlane
cp .env.example .env
openssl rand -hex 32   # paste as PROXLANE_API_KEY in .env, then add your provider keys
docker compose -f docker/compose.yml --env-file .env up -d
```

`--env-file` is not decoration: Compose takes its project directory from the compose file's
location, so without it your root `.env` is never read and the gateway refuses to boot.
Full guide, including droplets and what Vercel's container support does and does not cover:
[`docs/self-hosting.md`](docs/self-hosting.md).

One gateway on :8787. No dashboard, no Postgres, no worker — none of them exist yet, and
shipping empty services would be furniture rather than a deployment. Valkey ships commented
out: it is what lets you run more than one gateway, and a single one does not need it.

Your keys, your infrastructure, your scraped data. **Nothing phones home** — there is no
telemetry in the gateway or the CLI, and the only hosts either one contacts are the provider
you configured and the URL you asked for.

## Providers

<!-- generated:providers -->
| Provider | Status | JS render | Geo | Sessions | POST | render cost |
|---|---|---|---|---|---|---|
| ScraperAPI | **shipped** | yes | all | yes | — | 10× |
| ScrapingBee | **shipped** | yes | 42 regions | — | — | 5× |
| Scrapfly | **shipped** | yes | all | — | — | 6× |
| Bright Data Web Unlocker | **shipped** | yes | all | — | yes | 1× |
| Zyte | planned | | | | | |
| Oxylabs Web Scraper API | planned | | | | | |
| ScrapingAnt | planned | | | | | |
| Firecrawl | planned | | | | | |
<!-- /generated:providers -->

Want one that is not here? [Open an issue](https://github.com/proxlane/proxlane/issues),
or write the adapter yourself. See below.

Generated from the capability registry by `scripts/readme-providers.ts`, and asserted
byte-identical by `pnpm repo:check`, so it cannot drift from what the router does. Every
`shipped` row is a provider with a recorded fixture set and a place in the failover chain.

`render cost` is the multiplier on a rendered request, which is the number worth comparing:
the same page costs 10× on one line and 1× on another.

## Pricing

Three ways to run it. Two of them are free.

| | Cost | Requests run on |
|---|---|---|
| **BYOK** | free, forever | your provider accounts |
| **Self-host** | free, forever | your provider accounts, your servers |
| **Hosted credits** | provider cost + 5% | our provider accounts |

Hosted credits are pay as you go, no subscription, and you are only charged for
requests that pass block detection. A 200 with a CAPTCHA in it is not a success and
you do not pay for it.

**The 5% is not settled.** Those two promises are in tension: the provider still bills us
for the CAPTCHA-200 our detector rejects, which makes 5% negative-margin, and every
improvement to detection makes it worse. Whether hosted credits ship at a higher rate, with
a cap on absorbed blocks, or not at all is an open decision — see
[`docs/state.md`](docs/state.md). **BYOK and self-host are unaffected**, and they are the
launch modes.

## How it works

```
your scraper
  -> Proxlane gateway
       auth, translate, route
  -> provider A         blocked, cooled down for this domain
  -> provider B         200, passes detection
  <- HTML + outcome headers
```

Adapters are pure functions. `translate()` turns a Proxlane request into a provider
request, `parse()` turns a provider response into a typed outcome. All network I/O
goes through one shared transport, which is why the test suite runs against recorded
real provider traffic instead of hand-written mocks.

Every provider response is validated against a schema. When a provider changes their
API, the parse fails loudly with a `PROVIDER_DRIFT` outcome instead of quietly
returning garbage. A scheduled canary runs every adapter against the live APIs and
opens an issue when something moves.

Architecture details: [`docs/integrations.md`](docs/integrations.md)

## Writing an adapter

```bash
pnpm new-adapter myprovider   # scaffolds capabilities, translate/parse, schema, fixtures
pnpm record --adapter=myprovider   # captures real responses with your trial key
pnpm conformance --adapter=myprovider
```

Green conformance means the adapter is correct: every parameter translates without
leaking provider defaults, every response category maps to the right outcome, and
declared capabilities match what the live API actually does.

That is the whole contribution bar. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

**Works today**, and every line of it is covered by a command you can run:

- **Four adapters** — ScraperAPI, ScrapingBee, Scrapfly, Bright Data — each recorded against
  its live API, with `pnpm conformance` asserting purity, capability honesty and the outcome
  mapping. The table above is generated from the registry, so it cannot lag behind this line.
- **The failover chain**: capability filtering, per-hop budgets that reserve time for the
  hops behind them, and retry semantics read from one central table rather than decided per
  adapter.
- **The edge guard**, refusing private ranges and cloud metadata by every spelling the URL
  parser accepts. `pnpm test:ssrf`.
- **`GET /v1?api_key=…&url=…`**, deliberately ScraperAPI-shaped so migration is a hostname
  change.
- **A CLI** — `npx proxlane scrape|providers|outcomes|doctor`, `--json` on all of it.

**Exists now**: block detection, so `SOFT_BLOCK` is produced; cooldowns, on by default, with
`Retry-After` when every provider is cooling; provider health, **off by default** because its
calibration assumes failures that do not clump the way real ones do — `PROXLANE_HEALTH=on`,
and read `GET /health/providers`.

**Does not exist yet**: any database, request log or dashboard; hosted credits.

`pnpm repo:check` reports which of the 26 commands are real. It is asserted against the
filesystem, so it cannot drift the way a status section can — and it caught this one lying
twice.

Several commercial decisions are deliberately open and recorded in
[`docs/state.md`](docs/state.md) rather than assumed — including whether hosted credits
ship at all, since at cost + 5% they are negative-margin against our own block-detection
promise.

## License

Split on purpose, and the split is the point.

**Apache-2.0** — `adapters`, `detect`, `sdk`, `shared`. Write an adapter or build on the
SDK without inheriting copyleft. Adapters are the thing we most want written by strangers,
and a copyleft adapter layer would be a tax on exactly that.

**AGPL-3.0-only** — the gateway, the web app, `api`, `db`, `ui`, `route-viz` and the CLI.
Use it, self-host it, modify it, run it for your company. If you offer it to others as a
hosted service, your changes stay open.

`pnpm repo:check` enforces the direction: an Apache package may never depend on an AGPL
one, because that dependency is what relicenses.
