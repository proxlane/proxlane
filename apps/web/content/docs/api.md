---
title: API reference
summary: Every endpoint, parameter and header the gateway implements.
---

Everything here is implemented. Parameters the gateway does not read are not listed, and
`pnpm docs:check` fails the build if this page and the code disagree.

There is also a machine-readable description at
[`/openapi.json`](https://proxlane.dev/openapi.json). It is generated from the same outcome
taxonomy the router uses, so its status codes and enums are the real ones. Point a client
generator at it, or open it in any OpenAPI viewer.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1` | Scrape a URL |
| `POST` | `/v1` | Scrape a URL and forward a request body |
| `GET` | `/health` | Liveness. Needs no key |
| `GET` | `/health/providers` | Per-provider health. Needs `PROXLANE_HEALTH=on` to be meaningful |
| `GET` | `/health/cooldowns` | What is cooling now, and what expired recently |

`PUT` and `DELETE` on `/v1` return 404. They are not treated as `GET`.

## Parameters

| Parameter | Required | Values | Meaning |
|---|---|---|---|
| `url` | yes | absolute URL | The page to fetch |
| `api_key` | yes | string | The gateway's key. `Authorization: Bearer` is preferred |
| `render` | no | `true`, `1` | Run JavaScript on the target |
| `premium` | no | `none`, `residential`, `stealth` | Proxy tier. Defaults to `none` |
| `country_code` | no | ISO 3166-1 alpha-2 | Where the request should appear to come from |
| `provider` | no | adapter id | Force one provider and disable failover |
| `timeout` | no | milliseconds | Deadline for the whole request. Capped at the server's own |

### url

Rejected at the edge if it resolves to a private range, a denylisted host, or a cloud
metadata address. That returns `TARGET_FORBIDDEN`.

### render

Only `true` and `1` enable rendering. Every other value, including leaving the parameter
out, means false.

This is deliberate. Presence alone never counts as true. Otherwise `render=false` would
render the page and cost about five times as much.

### provider

A benchmarking escape hatch. It pins one provider, so there is no failover. If that provider
cannot serve the request, you get `NO_PROVIDER_AVAILABLE` rather than a silent substitution.

### timeout

The deadline for the whole request, in milliseconds, including every failover hop. Default is
the server's `PROXLANE_DEADLINE_MS`.

You can ask for less time than the server budgeted. You cannot ask for more: the ceiling is
what bounds how long one request holds a slot, and the gateway's memory sizing depends on it.

The floor is 8000. Below that a single attempt cannot finish, so the request would time out
without having tried anything — that is a `400`, not a `504`.

When the deadline runs out the outcome is `BUDGET_EXCEEDED`.

## POST requests

The body is forwarded as text, byte for byte. Proxlane does not parse it. Guessing between
JSON and form encoding would corrupt one of them.

```bash tab=cURL
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  --data '{"q":"example"}' \
  "https://your-gateway/v1?url=https://example.com/search"
```

```python tab=Python
res = requests.post(
    "https://your-gateway/v1",
    params={"url": "https://example.com/search"},
    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    data='{"q":"example"}',
)
```

```javascript tab=Node
const res = await fetch(
  `https://your-gateway/v1?url=${encodeURIComponent("https://example.com/search")}`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ q: "example" }),
  },
);
```

Request bodies use the same size cap as responses. Over it, you get `RESPONSE_TOO_LARGE`.

## Response headers

| Header | Sent | Meaning |
|---|---|---|
| `X-Outcome` | every scrape | What happened. See [outcomes](/docs/outcomes) |
| `X-Outcome-Class` | always | The coarse class. Branch on this one |
| `X-Attempts` | always | How many providers were tried |
| `X-Cost-Estimate` | always | Credits across all attempts |
| `Server-Timing` | always | `gw` is Proxlane, `up` is the providers, `total` is both |
| `X-Request-Id` | always | Quote this in a support thread |
| `X-Provider-Used` | when one served | Omitted, never empty, if nothing served |
| `X-Detect-Rule` | when a rule fired | Which block-page rule produced a `SOFT_BLOCK` |
| `X-Provider-Health` | when health is on | `demoted-forced` means every provider was demoted and the least bad was used |
| `Retry-After` | when known | Seconds, rounded up |

Two of those are easy to misread.

A request rejected before a provider was chosen — no `url`, a bad `premium`, a wrong key —
carries `X-Outcome-Class`, `X-Attempts: 0` and `X-Cost-Estimate: 0.000000`. It has no
`X-Outcome`, because the taxonomy describes what happened to a scrape and that request never
became one. This is the reason to branch on the class.

**`X-Cost-Estimate` covers every attempt**, not just the one that worked. A failover that
burned two charged hops reports both.

**`Retry-After` is never guessed.** If it is absent, Proxlane does not know when to retry. A
number you can trust is worth more than a number that is always present.

## Branching on results

Branch on `X-Outcome-Class`, not `X-Outcome`.

`X-Outcome` is open and gains members as adapters land. `X-Outcome-Class` has six values and
does not grow. Code written against the class keeps working when the vocabulary expands.

```typescript tab=TypeScript
switch (res.headers.get("x-outcome-class")) {
  case "ok":       return res;           // you have the page
  case "blocked":  return retryLater();  // every provider was blocked
  case "target":   return giveUp();      // the site itself said no
  case "client":   throw new Error("fix the request");
  case "provider": // fallthrough: transient, safe to retry
  case "gateway":  return retryLater();
}
```

```python tab=Python
outcome_class = res.headers["X-Outcome-Class"]

if outcome_class == "ok":
    return res.text                      # you have the page
if outcome_class == "target":
    return None                          # the site itself said no
if outcome_class == "client":
    raise ValueError("fix the request")
return retry_later()                     # blocked, provider or gateway
```

## Errors

When there is no page to return, the body is JSON instead of an empty success.

```json
{
  "requestId": "01JD8F2K9WQ3",
  "error": {
    "code": "NO_PROVIDER_AVAILABLE",
    "class": "gateway",
    "message": "No adapter matches the capability, or the chain is exhausted",
    "docs": "https://github.com/proxlane/proxlane#outcomes"
  },
  "attempts": [
    { "provider": "scraperapi", "outcome": "SOFT_BLOCK", "detectRuleId": "cf-challenge" }
  ]
}
```

`error.code` is the outcome. One vocabulary covers failures at a provider and failures before
one was reached.

`UNAUTHORIZED` is the exception. It is not an outcome, because outcomes describe what
happened to a scrape, and a request rejected at the door never became one.

`attempts` lists what was tried and what each provider said. That is the grain you need when
debugging a failover.

## Backpressure

Past its concurrency ceiling the gateway returns **429 `GATEWAY_BUSY`** with `Retry-After`.

It sheds rather than queues. A queued scrape holds your socket open while its own deadline
runs down, so you get a timeout with no explanation instead of a 429 you can act on.

The class is `gateway`, not `provider`. No provider throttled you. `/health` is never shed,
so a busy gateway does not fail its own health check.
