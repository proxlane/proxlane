---
title: 200 response with a captcha page
summary: A 200 status is not proof of content. Here is the outcome that catches the gap, and what it actually checks for.
query: scraper returns 200 but body is a captcha
---

The expensive failure in scraping is the one that looks fine. The HTTP status is 200, your
code stores the body, and the body is a challenge page instead of the page you asked for.
Status-code checks cannot see this. Something has to read the bytes.

## The outcome: SOFT_BLOCK

Proxlane runs every response body through a detector before returning it. If a known
anti-bot vendor's markup is in there, the outcome is `SOFT_BLOCK` regardless of what status
code the provider handed back.

```
X-Outcome: SOFT_BLOCK
X-Outcome-Class: blocked
X-Detect-Rule: cloudflare-challenge
X-Attempts: 2
X-Chain: scraperapi:SOFT_BLOCK>scrapfly:OK
```

`X-Detect-Rule` names which rule fired. Class `blocked` fails over on its own, so seeing
`SOFT_BLOCK` in a final response means every provider in the chain hit the same wall on that
domain, not just the first one.

The 200 in the query that brought you here is what the provider handed back, not what
Proxlane returns. Once the detector reclassifies it, Proxlane's own response to you carries
HTTP 502, so a caller checking status codes stops seeing a false success at all.

## What the detector actually checks

Six rules, each anchored to a specific string a named anti-bot vendor's own challenge markup
emits: Cloudflare's interstitial script path, Cloudflare's error page markup, DataDome's
captcha host, PerimeterX's cookie name, Imperva's resource path, Akamai's error asset host.
Nothing here is a keyword match on words like "captcha" or "blocked": that would flag a
genuine article about bot detection as a block, and a false positive here spends a second
provider's credits fetching a page Proxlane already had.

```typescript
// simplified from packages/detect
{
  id: 'cloudflare-challenge',
  test: (html) => html.includes('/cdn-cgi/challenge-platform/'),
}
```

## What it does not catch, stated plainly

A site running its own block page, no recognizable vendor, just a 200 saying "you have been
blocked" in its own words, has no fingerprint to match against. Proxlane calls that `OK`,
because as far as the detector can tell nothing distinguishes it from ordinary content. There
is no length heuristic or keyword rule standing in for that gap, on purpose: either one would
misfire on real pages more often than it would catch a real block.

Also worth knowing before you rely on this in production: every rule above is written from
each vendor's public challenge markup, and none has yet been confirmed against a real
captured block from that vendor. That is stated in the source rather than hidden, because a
rule that has only ever been tested against itself is a hypothesis, not a guarantee.

## Check for it in code

```python
res = requests.get(
    "https://your-gateway/v1",
    params={"url": "https://example.com"},
    headers={"Authorization": f"Bearer {key}"},
)
if res.headers.get("X-Outcome") == "SOFT_BLOCK":
    rule = res.headers.get("X-Detect-Rule")
    # every provider hit the same wall; retrying now repeats it
```

```javascript
if (res.headers.get("x-outcome") === "SOFT_BLOCK") {
  const rule = res.headers.get("x-detect-rule");
  // handle as a block, not as content
}
```

Branch on `X-Outcome-Class === "blocked"` if you don't need to know which rule fired, only
that the body is not trustworthy.

## Related

- [How failover works](/docs/failover): what happens between the first block and the
  response you see.
- [Outcomes reference](/docs/outcomes): the full table, including what carries a body back
  and what doesn't.
- [Block page detector](/block-page-detector): paste the body you got and see which rule
  fires, if any. Runs in your browser.
