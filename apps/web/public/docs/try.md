<!-- Source: https://proxlane.dev/docs/try — edit apps/web/content/docs/try.md -->
---
title: Try it in 60 seconds
summary: See a failover and a caught block page, with no provider account and nothing spent.
---

The gateway has a sandbox: a second key that answers from its own outcome table and never calls
a provider. It returns the real headers, so you can see what Proxlane does before you have a
provider key, and test your own client against every outcome without paying for one.

## Start a gateway

```bash
export PROXLANE_API_KEY=$(openssl rand -hex 32)
export PROXLANE_SANDBOX_KEY=$(openssl rand -hex 16)
docker run -d --rm --pull always --name proxlane-try -p 8787:8787 \
  -e PROXLANE_API_KEY -e PROXLANE_SANDBOX_KEY \
  -e SCRAPERAPI_KEY=x -e SCRAPFLY_KEY=x -e SCRAPINGBEE_KEY=x \
  ghcr.io/proxlane/gateway:latest
```

`-d` runs it in the background, so the same terminal can make the requests below. `--pull always`
because Docker otherwise reuses any `latest` it pulled before, however old. The sandbox
key is generated rather than printed here: it cannot spend, but a published one on a reachable
server would let anyone fill the gateway's request slots.

The provider keys are placeholders. The sandbox never sends them anywhere; they only exist so
the chain has three providers to walk. Leave them out and it walks one.

## A page that worked

```bash
curl -sD - -o /dev/null "http://localhost:8787/v1?url=https://example.com" \
  -H "Authorization: Bearer $PROXLANE_SANDBOX_KEY"
```

```
HTTP/1.1 200 OK
X-Outcome: OK
X-Outcome-Class: ok
X-Provider-Used: scraperapi
X-Attempts: 1
X-Chain: scraperapi:OK
X-Cost-Estimate: 0.000000
X-Proxlane-Simulated: OK
```

One provider, one attempt, a page. `X-Proxlane-Simulated` is on every sandbox response, so a
simulated 200 can never be mistaken for a real one.

## A page that was blocked

```bash
curl -sD - -o /dev/null "http://localhost:8787/v1?url=https://example.com" \
  -H "Authorization: Bearer $PROXLANE_SANDBOX_KEY" \
  -H "X-Proxlane-Simulate: SOFT_BLOCK"
```

```
HTTP/1.1 502 Bad Gateway
X-Outcome: SOFT_BLOCK
X-Outcome-Class: blocked
X-Chain: scraperapi:SOFT_BLOCK>scrapfly:SOFT_BLOCK>scrapingbee:SOFT_BLOCK
X-Attempts: 3
X-Detect-Rule: cloudflare-blocked
X-Proxlane-Simulated: SOFT_BLOCK
```

This is what a captcha page looks like through Proxlane. A provider returned HTTP 200 with a
challenge in the body; the detector caught it, the chain tried the next provider, then the
next, and the answer says so instead of handing you the captcha as content. Every outcome on
the [outcomes page](/docs/outcomes) works the same way: put its name in the header.

## Then with a real key

Stop the container with `docker stop proxlane-try`, replace a placeholder with a real provider
key, drop the sandbox key and the header, and the same request goes to the provider. Nothing else
about the request changes.
The [quickstart](/docs/quickstart) has the rest, and the [providers page](/docs/providers) says
where to get a key and which to start with.
