---
title: Migrate from ScraperAPI
summary: Change the hostname and keep your parameter names. Your ScraperAPI key moves into the gateway's environment, and the api_key in your request becomes the gateway's own. Everything else that changes is listed below, including the parameters that do not carry over.
query: scraperapi drop-in replacement
---

Proxlane's request shape is ScraperAPI's on purpose, so most code migrates by changing one
string. The gateway then puts failover, block detection and cost reporting in front of the
same account you already have.

## The one-line change

```diff
- https://api.scraperapi.com/?api_key=KEY&url=https://example.com&render=true
+ http://localhost:8787/v1?api_key=GATEWAY_KEY&url=https://example.com&render=true
```

`localhost:8787` is wherever you run the gateway. There is no hosted endpoint; the
[quickstart](/docs/quickstart) starts one in about a minute.

## The key changes meaning

On ScraperAPI, `api_key` is your provider credential. On Proxlane it is the **gateway's** key,
the one you invent when you start it. Your ScraperAPI key goes into the gateway's environment
and never leaves it:

```bash
export PROXLANE_API_KEY=$(openssl rand -hex 16)   # what your client will send
export SCRAPERAPI_KEY=...                         # what the gateway sends to ScraperAPI
docker run -p 8787:8787 -e PROXLANE_API_KEY -e SCRAPERAPI_KEY ghcr.io/proxlane/gateway
```

Prefer the header form in new code. `api_key` in the query string still works because that
is what you are migrating from, but query strings end up in access logs and error trackers:

```bash
curl -H "Authorization: Bearer $PROXLANE_API_KEY" \
  "http://localhost:8787/v1?url=https://example.com&render=true"
```

## Parameter map

Read from the adapter's translation step, not from memory. Every row is what the gateway
actually sends.

| ScraperAPI | Proxlane | What to know |
|---|---|---|
| `url` | `url` | Same |
| `render=true` | `render=true` | Same name, same meaning |
| `country_code=us` | `country_code=us` | Same. Lower-cased before it is sent |
| `premium=true` | `premium=residential` | One parameter with named tiers instead of two booleans |
| `ultra_premium=true` | `premium=stealth` | `stealth` is our word for their advanced bypass tier |
| `wait_for_selector=.x` | `wait_for=.x` | Implies `render=true`, so you can drop that flag |
| `session_number=N` | none today | Ignored and named in `X-Ignored-Params`. See below |
| `keep_headers` | none today | Ignored |
| `device_type` | none today | Ignored |
| `autoparse` | none today | Ignored. The gateway returns the page, not a parsed object |
| `output_format` | none today | Ignored. The body is the target's body, unchanged |
| `screenshot` | none today | Ignored |
| `follow_redirect` | none today | Ignored. Not exposed as a parameter |

Two ScraperAPI habits stop mattering. You do not need to send `render=true` alongside
`wait_for`, because a wait condition only makes sense on a rendered page and the gateway sets
it for you. And you do not choose between `premium` and `ultra_premium` by flag combination;
`premium` takes one of `none`, `residential`, `stealth`.

## What you send that the gateway does not read

The gateway never rejects a parameter it does not recognise, because rejecting would break
exactly this migration. Instead the response names what it threw away:

```
X-Ignored-Params: autoparse,session_number
```

Wire that header into your logs before you switch traffic. `session_number` is the one that
catches people: it is silently a plain request until you look.

## Costs

ScraperAPI charges per credit and the multipliers are named values, not a formula. From their
parameter documentation, as read on 2026-08-31:

| Request | Credits |
|---|---|
| plain | 1 |
| `render=true` | 10 |
| `premium=true` | 10 |
| `premium=true` with `render=true` | 25 |
| `ultra_premium=true` | 30 |
| `ultra_premium=true` with `render=true` | 75 |

Proxlane reports what each request cost in `X-Cost-Estimate`, and `X-Cost-Source: reported`
means the figure came from ScraperAPI's own response header rather than this table. Their
per-domain surcharges (Amazon, Google, bot-protected sites) are not in the table and cannot
be, because they are decided after the request; the reported figure includes them.

## What changes for the better

**A 200 with a captcha in it is no longer a success.** ScraperAPI documents that this can
happen and asks you to report it. The gateway reads every body before it calls anything OK,
and answers `SOFT_BLOCK` with the rule that fired. [Read how that works](/symptoms/200-captcha-body).

**A block fails over instead of failing.** Add a second provider's key and a request ScraperAPI
cannot serve goes to the next line. [Failover](/docs/failover) explains the chain and what it
costs. With one key, nothing fails over, and you still get the block detection and the headers.

**Every response says what happened.** `X-Outcome` and `X-Outcome-Class` replace status-code
guessing. A 404 is `TARGET_NOT_FOUND` and is never retried through another provider, because
ScraperAPI charges for 404s and so does everyone else. The full list, with what to do about
each one, is on the [outcomes](/docs/outcomes) page, and every parameter and header is on the
[API reference](/docs/api).

## What you lose

Sessions, auto-parsing, screenshots, output formats and custom request headers are not
exposed through the gateway today. If your integration depends on one of them, that part
stays on ScraperAPI directly. Pinning `provider=scraperapi` does not pass unknown parameters
through; it only fixes which provider serves the request.

## Node

```js
const url = new URL('http://localhost:8787/v1');
url.searchParams.set('url', target);
url.searchParams.set('render', 'true');
url.searchParams.set('premium', 'residential');   // was premium=true

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${process.env.PROXLANE_API_KEY}` },
});
console.log(res.headers.get('x-outcome'), res.headers.get('x-ignored-params'));
const html = await res.text();
```
