---
title: Scraper returns 403
summary: Only one outcome actually gives you back a 403. Here is what the other two look like instead, and why.
query: why does my scraper get 403
---

A 403 while scraping is almost always the site refusing you rather than anything wrong with
your code. The awkward part is that a bare 403 does not say which kind of refusal it is, and
the three kinds want completely different fixes: your IP is not welcome, your credentials are
wrong, or the anti-bot layer decided you are a bot.

You can usually tell them apart from the response you already have, without installing
anything. A 403 with an HTML body full of challenge markup is anti-bot. A 403 with a short
JSON error naming a key or a plan is credentials. A 403 on every URL including ones that
should not exist is an IP-level block.

The rest of this page is how a gateway makes that distinction explicit, if you would rather
not read block pages by hand.

## The one real 403: TARGET_FORBIDDEN

Proxlane's own edge guard rejected the request before any provider ran. The `url` resolves to
a private IP range, a denylisted host, or a cloud metadata address (`169.254.169.254` and
equivalents). No provider is charged, because none was called.

```
HTTP/1.1 403 Forbidden
X-Outcome: TARGET_FORBIDDEN
X-Outcome-Class: client
X-Attempts: 0
```

`X-Attempts: 0` is the tell. This never retries and never fails over. It is not a network
problem, it is a request that should not have been sent. Fix the URL.

## The other two: normalized to 502

**`AUTH_FAILED`.** A provider rejected the key you gave it, usually a 401 or 403 on that
provider's own API, not on the target page. Proxlane does not pass that status through:

```
HTTP/1.1 502 Bad Gateway
X-Outcome: AUTH_FAILED
X-Outcome-Class: provider
X-Attempts: 2
X-Chain: scraperapi:AUTH_FAILED>scrapfly:OK
```

The gateway already failed over to a different provider and marked the failed key unhealthy.
If every provider returns this, every key is wrong or expired, and what comes back is the
last provider's own `AUTH_FAILED`, not `NO_PROVIDER_AVAILABLE`. That name means nothing was
tried at all: no provider could serve the request, or every one of them was on cooldown.

**`HARD_BLOCK`.** The target itself refused the request, often with its own 403, and the
provider reported that as a block rather than ordinary content. This is the target's anti-bot
layer working as designed, not a bug on either end. Proxlane returns the provider's block
page with a stable status rather than the target's raw code:

```
HTTP/1.1 502 Bad Gateway
X-Outcome: HARD_BLOCK
X-Outcome-Class: blocked
X-Attempts: 3
X-Chain: scraperapi:HARD_BLOCK>scrapingbee:HARD_BLOCK>scrapfly:HARD_BLOCK
```

Class `blocked` fails over on its own. Seeing this in the final response means the whole
chain was tried and every provider was refused for that domain right now. Retrying
immediately repeats the same answer; the domain enters a cooldown so nothing hammers it in
the meantime.

## Check the header, not the status code

```bash
curl -sD - "https://your-gateway/v1?api_key=$KEY&url=https://example.com" -o /dev/null \
  | grep -i '^x-outcome'
```

```python
res = requests.get(
    "https://your-gateway/v1",
    params={"url": "https://example.com"},
    headers={"Authorization": f"Bearer {key}"},
)
print(res.headers.get("X-Outcome"), res.headers.get("X-Outcome-Class"))
```

Branch on `X-Outcome-Class`, since it is the closed vocabulary: `client` means fix the
request, `provider` means Proxlane already retried for you, `blocked` means every provider
struck out on this domain right now.

## Why the status code gets rewritten

A raw pass-through would mean two unrelated failures both showing up as "403," and code
written against one would silently mishandle the other. Every failure maps to exactly one
outcome with a defined status and a defined meaning, so `X-Outcome` always says which of the
three above actually happened, instead of leaving you to infer it from a code that only ever
means one of them honestly.

## Related

- [Outcomes reference](/docs/outcomes): the full table of every outcome, its HTTP status,
  and whether it fails over.
- [API reference](/docs/api): every response header, including `X-Chain` and
  `X-Outcome-Class`, and how to branch on them.
