---
title: Scrapy
summary: Route a Scrapy spider through the gateway with one downloader middleware.
---

`scrapy-proxlane` is a downloader middleware. It sends every request through the gateway and
hands the gateway's verdict back to the spider, so a block or a failover is visible in the
callback instead of arriving as a status code with no story behind it.

It is Apache-2.0, published on [PyPI](https://pypi.org/project/scrapy-proxlane/), and
developed at [proxlane/scrapy-proxlane](https://github.com/proxlane/scrapy-proxlane).

## Install

```bash
pip install scrapy-proxlane
```

You need a gateway running. One container with your own provider keys, as in
[Quickstart](/docs/quickstart), or the sandbox below if you have no provider account yet.

## Configure

```python
# settings.py
DOWNLOADER_MIDDLEWARES = {
    "scrapy_proxlane.ProxlaneMiddleware": 585,
}
PROXLANE_URL = "http://localhost:8787"
PROXLANE_API_KEY = "..."  # the gateway's key, not a provider's
PROXLANE_DEFAULT_RENDER = False  # rendering costs up to 10x, so opt in per request
```

Priority 585 sits after `RetryMiddleware` at 550, so a retry re-enters the middleware, and
before `HttpProxyMiddleware` at 750.

Nothing else in the spider changes. Responses carry the target's own URL, so relative links
resolve as they did before.

## Read the verdict

```python
def parse(self, response):
    info = response.meta["proxlane"]
    # {'outcome': 'OK', 'outcome_class': 'ok', 'provider': 'scrapfly', 'attempts': 2,
    #  'chain': 'scraperapi:PROVIDER_TIMEOUT>scrapfly:OK', 'cost': '6.000000', ...}
    if info["outcome_class"] == "blocked":
        return
```

Branch on `outcome_class`, which is a closed set of six values. `outcome` gains members as
adapters land, so a spider that switches on it will meet a name it does not know. Both are
described in the [outcomes reference](/docs/outcomes), and the underlying headers in the
[API reference](/docs/api).

The middleware also records Scrapy stats: `proxlane/requests`, `proxlane/attempts`,
`proxlane/outcome/<OUTCOME>` and `proxlane/provider/<id>`.

## Per-request options

```python
yield scrapy.Request(
    url,
    meta={
        "proxlane": {
            "render": True,
            "country_code": "de",
            "provider": "scrapfly",  # pin one provider, no failover
            "premium": "residential",
            "timeout": 30000,
            "wait_for": "#results",
            "binary": True,  # bytes intact, for images and PDFs
        }
    },
)
```

`meta={"proxlane": False}` sends that one request directly and skips the gateway.

## Test without spending

Run the gateway with `PROXLANE_SANDBOX_KEY` set, use that key in your test settings, and then
`meta={"proxlane": {"simulate": "SOFT_BLOCK"}}` returns exactly what a blocked page returns,
headers included, without calling a provider. A live key refuses the simulate header with a
400, so a test cannot spend by accident. See [Try it in 60 seconds](/docs/try).

The package's own integration tests run this way, against a real gateway container.
