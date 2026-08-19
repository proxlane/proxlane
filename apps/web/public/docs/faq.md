<!-- Source: https://proxlane.dev/docs/faq — edit apps/web/content/docs/faq.md -->
---
title: Questions people actually ask
summary: What Proxlane does, what it costs, what happens to your keys, and what it will not do.
---

Short answers. Each one links to the page that goes deeper.

## What is Proxlane?

One endpoint in front of every scraping API provider. You send it a URL, it picks a provider
that can serve that request, and if the provider fails it tries the next one. Same parameter
names as the provider you are already using, so the migration is a hostname.

It is not a proxy network and it does not scrape anything itself. It routes to the providers
you already pay, on your keys.

## What is the difference between this and calling a provider directly?

Calling one provider directly is fine until it is not. The difference shows up on the bad
request, not the good one:

- **A provider fails and you get nothing.** Proxlane tries the next one that can serve the
  request, inside the deadline you gave it. See [how failover works](/docs/failover).
- **A provider returns 200 with a block page in it.** Direct, that is a success. Proxlane
  classifies it and fails over. See [outcomes](/docs/outcomes).
- **A provider cannot do what you asked.** Not every provider renders JavaScript, and not
  every provider can return a file byte for byte. Proxlane filters the chain by capability
  before it spends anything.
- **You want to change provider.** One environment variable instead of a code change.

If you use one provider, it has never failed you, and you have never had a blocked response
come back as a 200, you do not need this.

## Do I have to rewrite my code?

No. Change the hostname:

```diff
- https://api.scraperapi.com/?api_key=KEY&url=https://example.com
+ http://localhost:8787/v1?api_key=KEY&url=https://example.com
```

Same parameter names, same response body. The extra information arrives as response headers,
so code that ignores headers keeps working unchanged. See the
[API reference](/docs/api) for the full list.

## What happens if a provider has an outage?

The request goes to the next capable provider in the chain, and the failing provider is put
on a cooldown so the next caller does not pay to rediscover the same outage. The response
tells you what happened: `X-Provider-Used` names who served it and `X-Attempts` says how many
were tried.

Cooldowns are on by default and route live traffic today. See
[how failover works](/docs/failover).

## What happens to my provider API keys?

Self-hosting is the only way to run Proxlane today, so the answer is short: your keys are
environment variables on your own machine, they are read at boot, and they are sent to the
provider they belong to and nowhere else. There is no Proxlane server to send them to. We
cannot see them because there is no "we" in the request path.

## What do you log?

The gateway writes one line per request to stdout, and you own the stdout. Each line records
the target's **host**, not the full URL, because a full URL routinely carries session tokens
and API keys, including the gateway's own `api_key` parameter. It records no request body and
no response body.

`PROXLANE_LOG_URLS=on` opts into full URLs if you want them. `PROXLANE_LOG=off` turns the log
off entirely, which is a real setting rather than a level nobody uses.

## Can I use my own provider keys?

That is the only supported mode, and it is free forever. Bring your own keys, run the
gateway, pay your providers directly at whatever rate you negotiated with them. Proxlane adds
nothing to that bill.

## What does it cost?

Nothing today, because the only way to run it is to run it yourself. There is no hosted
endpoint and no billing.

Hosted credits are planned at provider cost plus a flat fee, and the fee is **not settled**:
we would only charge for requests that pass block detection, while the provider still bills
us for the blocked ones, and those two promises are in tension. Whether it ships at a higher
rate, with a cap, or not at all is an open decision. BYOK and self-host are unaffected.

## Which providers are supported?

The current list lives in the [README's Providers table](https://github.com/proxlane/proxlane#providers),
and it is not written here on purpose: that table is generated from the capability registry
and asserted byte-identical, so it cannot claim a provider that does not exist. A number typed
into this page could, the day after an adapter lands.

If yours is not there, you can add it without waiting for us. An adapter is two functions,
`translate` and `parse`, and the packages you need are Apache-2.0 precisely so writing one
does not pull you into copyleft. See [bring your own provider](/docs/adapters).

## Do I need provider API keys to contribute?

No, and this is the part worth knowing. Contract tests replay recorded fixtures, so you can
write an adapter and run `pnpm conformance` with nothing but Node, pnpm and Docker.

The corollary, so a skipped job does not look like your fault: the live canary cannot run on
a pull request from a fork, because GitHub does not expose secrets there. Merging a community
adapter needs a maintainer to run it on house keys.

## Can it download images, PDFs and other binary files?

Yes, with `binary=true`, and the flag exists because getting this wrong is silent. A provider
that decodes a response body as text returns **200 OK** with a file that is the right length
in characters and the wrong length in bytes. Measured on a 35 KB JPEG: one provider returned
64 KB of it, with 14,807 replacement characters where the image used to be. Nothing short of
comparing bytes catches that.

Carrying bytes intact is therefore a declared capability, and `binary=true` routes only to
providers that declare it. If none of your configured providers can, you get
`NO_PROVIDER_AVAILABLE` rather than a corrupt file.

## Is this production ready?

Parts of it. The gateway, the failover chain, the detector, cooldowns and the shipped
adapters are built and tested. The block detector's rules come from vendor signatures and
have never seen a real block page in the wild, which is the honest caveat on the feature the
product is named for.

The [README's Status section](https://github.com/proxlane/proxlane#status) is kept accurate
rather than aspirational, and a repository check fails the build if it drifts from what
actually ships.

## What will it not do?

- It will not scrape anything itself. It routes to providers you pay.
- It will not make an unblockable request. If every capable provider is blocked, you get
  `NO_PROVIDER_AVAILABLE`, not a retry loop.
- It will not let a provider's affiliate rate influence routing. That is a rule, not a
  preference.
- It will not report a blocked page as a success in order to look better.
