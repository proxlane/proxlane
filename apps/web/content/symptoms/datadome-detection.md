---
title: DataDome block detection
summary: What the datadome rule actually matches, and what to do once it fires.
query: how to detect a datadome block
---

DataDome serves its captcha from a fixed host, which is what makes it identifiable at all. If
you are seeing `geo.captcha-delivery.com` or a `dd_cookie_test` reference in a response
body, here's what that means and what changes it.

## The outcome: SOFT_BLOCK, rule datadome

A DataDome challenge usually comes back as HTTP 200. The provider fetched something and
handed it over; nothing about the status code says it isn't the real page. Proxlane's
detector reads the body itself and reclassifies it:

```
X-Outcome: SOFT_BLOCK
X-Outcome-Class: blocked
X-Detect-Rule: datadome
X-Attempts: 3
X-Chain: scraperapi:SOFT_BLOCK>scrapingbee:SOFT_BLOCK>scrapfly:SOFT_BLOCK
```

The rule matches on `geo.captcha-delivery.com` or `dd_cookie_test`, both markers that appear
in DataDome's own served page and have no reason to appear in ordinary content. It does not
match on the word "captcha" or any generic phrase, because a keyword rule would misfire on
real pages that happen to mention bot detection, and every misfire here costs a second
provider's credits re-fetching a page Proxlane already had.

Class `blocked` already triggered failover before this response reached you. Three entries
in `X-Chain` means every provider in the chain hit DataDome on that domain in this attempt,
not that Proxlane only tried once.

## What actually might change the result

DataDome's decision leans heavily on IP reputation, more than most anti-bot vendors. The
documented lever is `premium`:

```
&premium=residential
&premium=stealth
```

This changes the proxy tier a provider routes through. Whether it changes the result against
a specific DataDome-protected site is not something this page can state as a fact, because
it depends on that site's own DataDome configuration and Proxlane does not measure
per-target outcomes to back a number. What's documented is the parameter and what it routes
to, not a success rate.

`country_code` can matter too, if the block is partly geographic, but it's "subject to
provider coverage" the same way it is everywhere else in the API, not a guarantee.

## Handling it in code

```python
res = requests.get(
    "https://your-gateway/v1",
    params={"url": "https://example.com", "premium": "residential"},
    headers={"Authorization": f"Bearer {key}"},
)
if res.headers.get("X-Detect-Rule") == "datadome":
    # every provider tried was recognized by DataDome on this request;
    # a domain-level cooldown is now active, retrying immediately repeats this
    ...
```

## One honest caveat about the rule itself

Like the other five vendor rules in the detector, `datadome` is written from DataDome's
publicly observable markup and has not yet been confirmed against a real captured DataDome
block. It's a documented hypothesis, stated as one, not tested folklore presented as settled.
If you have a real DataDome capture and want to help verify it, the corpus lives in
`packages/detect`.

## Related

- [Outcomes reference](/docs/outcomes): the full taxonomy, including what `blocked` means
  for retrying.
- [How failover works](/docs/failover): why three chain entries means every provider was
  tried, not just the first.
