---
title: Quickstart
summary: Make your first request in about a minute.
---

Proxlane is one endpoint in front of ScraperAPI, ScrapingBee, Scrapfly and Bright Data. If a provider
blocks, errors or times out, Proxlane tries the next one. The response tells you what
happened at every step.

## Start one

```bash
docker run -p 8787:8787 \
  -e PROXLANE_API_KEY="$(openssl rand -hex 32)" \
  -e SCRAPERAPI_KEY=... \
  ghcr.io/proxlane/gateway:latest
```

One provider key is enough. Providers you have no key for are left out of the chain, so add a
second when you want failover to have somewhere to go.

The gateway will not start without `PROXLANE_API_KEY`. It is the key **you** present to your
own gateway, it registers nowhere, and without it anyone who can reach the port can spend your
provider credits.

Your gateway is now on `http://localhost:8787`. There is no hosted endpoint to call instead.

## Make a request

```bash tab=cURL
curl "http://localhost:8787/v1?api_key=$PROXLANE_API_KEY&url=https://example.com"
```

```python tab=Python
import os

import requests

res = requests.get(
    "http://localhost:8787/v1",
    params={"url": "https://example.com"},
    headers={"Authorization": f"Bearer {os.environ['PROXLANE_API_KEY']}"},
    timeout=120,
)

print(res.headers["X-Outcome"], res.headers["X-Attempts"], "attempts")
html = res.text
```

```javascript tab=Node
const url = new URL("http://localhost:8787/v1");
url.searchParams.set("url", "https://example.com");

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${process.env.PROXLANE_API_KEY}` },
});

console.log(res.headers.get("x-outcome"), res.headers.get("x-attempts"), "attempts");
const html = await res.text();
```

The body is the target's body, unchanged. The headers carry everything else:

```http
HTTP/1.1 200 OK
X-Outcome: OK
X-Outcome-Class: ok
X-Attempts: 2
X-Provider-Used: scrapfly
X-Cost-Estimate: 0.002800
Server-Timing: gw;dur=1.7, up;dur=2451.0, total;dur=2452.7
X-Request-Id: 01JD8F2K9WQ3
```

Read that as: two providers were tried, the second one served the page, and it cost 0.0028
credits. Proxlane itself took 1.7 ms. The provider took the other 2.45 seconds.

## Migrate an existing integration

The query shape matches ScraperAPI's, so migrating is a hostname change.

```bash
# before
curl "https://api.scraperapi.com?api_key=KEY&url=https://example.com&render=true"

# after
curl "https://your-gateway/v1?api_key=KEY&url=https://example.com&render=true"
```

One thing changes meaning. `api_key` is now the **gateway's** key. Your provider keys stay in
the gateway's environment and are never sent by the client.

## Authenticate with a header instead

```bash tab=cURL
curl -H "Authorization: Bearer $PROXLANE_API_KEY" \
  "https://your-gateway/v1?url=https://example.com"
```

```python tab=Python
headers = {"Authorization": f"Bearer {os.environ['PROXLANE_API_KEY']}"}
```

```javascript tab=Node
const headers = { Authorization: `Bearer ${process.env.PROXLANE_API_KEY}` };
```

Prefer this in new code. `api_key` in the query string works, because that is what the
providers Proxlane replaces accept. But query strings end up in access logs, proxy logs,
`Referer` headers and error trackers. None of those should hold a credential.

## Next

- [API reference](/docs/api) for every parameter and header.
- [Outcomes](/docs/outcomes) for what each result means and whether you should retry.
- [Self-hosting](https://github.com/proxlane/proxlane/blob/main/docs/self-hosting.md) for
  Compose, VPS and reverse-proxy setups.

If something looks wrong, run `npx proxlane doctor`. It prints what it checked and what it
found, so the output is worth pasting into an issue.
