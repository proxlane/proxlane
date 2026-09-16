---
title: Migrate from ScrapingBee
summary: Change the hostname, rename three parameters, and stop paying five credits for a plain fetch. Your ScrapingBee key moves into the gateway's environment. Everything else that changes is listed below, including the parameters that do not carry over.
query: scrapingbee alternative open source
---

Proxlane puts one endpoint in front of the scraping APIs you already pay for, ScrapingBee
included, and adds failover, block detection and cost reporting on top of the same account.
Migrating is a hostname change plus three renamed parameters.

## The one-line change

```diff
- https://app.scrapingbee.com/api/v1/?api_key=KEY&url=https://example.com&render_js=true
+ http://localhost:8787/v1?api_key=GATEWAY_KEY&url=https://example.com&render=true
```

`localhost:8787` is wherever you run the gateway. There is no hosted endpoint; the
[quickstart](/docs/quickstart) starts one in about a minute.

## The key changes meaning

On ScrapingBee, the key is your provider credential. On Proxlane it is the **gateway's** key,
the one you invent when you start it. Your ScrapingBee key goes into the gateway's environment
and never leaves it:

```bash
export PROXLANE_API_KEY=$(openssl rand -hex 16)   # what your client will send
export SCRAPINGBEE_KEY=...                        # what the gateway sends to ScrapingBee
docker run -p 8787:8787 -e PROXLANE_API_KEY -e SCRAPINGBEE_KEY ghcr.io/proxlane/gateway
```

The gateway sends your key as a `Bearer` header rather than in the query string, which is the
form ScrapingBee's POST documentation requires and keeps the credential out of URLs that reach
logs. Prefer the header on your side too:

```bash
curl -H "Authorization: Bearer $PROXLANE_API_KEY" \
  "http://localhost:8787/v1?url=https://example.com&render=true"
```

## Parameter map

Read from the adapter's translation step, so every row is what the gateway actually sends.

| ScrapingBee | Proxlane | What to know |
|---|---|---|
| `url` | `url` | Same |
| `render_js=true` | `render=true` | Renamed. **Their default is true, ours is false.** See costs below |
| `premium_proxy=true` | `premium=residential` | One parameter with named tiers instead of two booleans |
| `stealth_proxy=true` | `premium=stealth` | Same parameter, third value |
| `country_code=de` | `country_code=de` | Same. Lower-cased before it is sent |
| `wait_for=.x` | `wait_for=.x` | Same name. Implies `render=true`, so you can drop that flag |
| `timeout=140000` | `timeout=<ms>` | Yours bounds the whole request. Their per-attempt ceiling is pinned to 70s, half their 140s default |
| `transparent_status_code` | always on | Not a parameter. See below |
| `session_id` | none today | Ignored. No provider in the chain sells sessions through Proxlane yet |
| `extract_rules`, `ai_query`, `ai_extract_rules`, `ai_selector` | none | Ignored. The gateway returns the page, not extracted fields |
| `screenshot`, `screenshot_full_page`, `screenshot_selector` | none | Ignored |
| `js_scenario`, `cookies`, `forward_headers`, `own_proxy` | none | Ignored |
| `return_page_source`, `return_page_text`, `return_page_markdown`, `json_response` | none | Ignored. The body is the target's HTML, unchanged |
| `block_ads`, `block_resources`, `device`, `window_width`, `window_height` | none | Ignored. Pinned so a change on their side cannot change what you receive |
| `mode`, `max_cost`, `scraping_config`, `tag` | none | Ignored |

Custom request headers do carry over: send them to the gateway and it applies ScrapingBee's
`Spb-` prefix for you.

## Two defaults that change, and both are in your favour

**`render_js` defaults to `true` at ScrapingBee.** A request that omits it renders the page and
bills 5 credits. Proxlane sets the flag explicitly on every request, so a plain fetch is a plain
fetch and costs 1. If your integration never sent `render_js=false`, your floor has been five
times what it needed to be.

**`transparent_status_code` defaults to `false`.** Without it, a target's 404 comes back to you
as a 200. The gateway pins it to `true`, so a 404 is a 404 and arrives as `TARGET_NOT_FOUND`,
which never fails over to another provider because a real 404 is real everywhere.

## Costs

ScrapingBee's table is a two-dimensional lookup, not a formula. As read on 2026-08-31:

| Request | Credits |
|---|---|
| plain | 1 |
| `render=true` | 5 |
| `premium=residential` | 10 |
| `premium=residential` with `render=true` | 25 |
| `premium=stealth` with `render=true` | 75 |

`premium=stealth` without rendering is not sold: their own table reads "coming soon", so the
gateway routes that combination elsewhere rather than guessing. Every response carries
`X-Cost-Estimate`, and `X-Cost-Source: reported` means the figure came from ScrapingBee rather
than this table.

## Geography is narrower than you may expect

The gateway routes `country_code` to ScrapingBee for 42 codes, their classic-proxy list. Their
premium pool reaches 243, but one capability set cannot say "these on classic, those on
premium", so the honest choice is the set that holds on every tier. Ask for a country outside
it and the request goes to a provider that can serve it. That matters because ScrapingBee's own
behaviour is to silently fall back to `us` for an unsupported country, which returns a
plausible page from the wrong place.

## What changes for the better

**A 200 with a captcha in it is no longer a success.** Every body goes through a block detector
before anything is called OK, and `X-Detect-Rule` names what fired.
[How that works](/symptoms/200-captcha-body).

**A block fails over instead of failing.** Add a second provider key and a request ScrapingBee
cannot serve goes to the next line. [Failover](/docs/failover) covers the chain and its cost.

**Every response says what happened.** `X-Outcome` and `X-Outcome-Class` replace status-code
guessing; the [outcomes](/docs/outcomes) page lists all of them with what to do about each, and
the [API reference](/docs/api) has every parameter and header. If you sent something the gateway
does not read, `X-Ignored-Params` names it, so wire that into your logs before you switch
traffic.

## Node

```js
const url = new URL('http://localhost:8787/v1');
url.searchParams.set('url', target);
url.searchParams.set('render', 'true');        // was render_js, and was the default
url.searchParams.set('premium', 'residential'); // was premium_proxy=true

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${process.env.PROXLANE_API_KEY}` },
});
console.log(res.headers.get('x-outcome'), res.headers.get('x-ignored-params'));
const html = await res.text();
```
