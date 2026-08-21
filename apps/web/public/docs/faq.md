<!-- Source: https://proxlane.dev/docs/faq — edit apps/web/content/docs/faq.md -->
---
title: Questions people actually ask
summary: What Proxlane does, what it costs, what happens to your keys, and what it will not do.
---

## What is Proxlane?

One endpoint in front of every scraping API provider. Send it a URL, it picks a provider that
can serve the request, and tries the next one if that fails.

It does not scrape anything itself. It routes to providers you already pay, on your keys.

## Why not just call a provider directly?

Because the difference shows up on the bad request, not the good one.

A provider goes down and you get nothing. A provider hands back 200 with a block page in it,
which your code reads as success. A provider cannot render JavaScript, or cannot return a file
without mangling it. Proxlane handles all four: it fails over, classifies blocks as failures,
and filters the chain by capability before spending anything.

If you use one provider, it has never failed, and you have never had a block come back as a
200, you do not need this.

## Do I have to rewrite my code?

No. Change the hostname.

```diff
- https://api.scraperapi.com/?api_key=KEY&url=https://example.com
+ http://localhost:8787/v1?api_key=KEY&url=https://example.com
```

Same parameters, same response body. Everything extra arrives in headers, so code that ignores
headers keeps working. Full list in the [API reference](/docs/api).

## What happens during an outage?

The request moves to the next capable provider, and the failing one goes on cooldown so the
next caller does not pay to rediscover the same outage.

`X-Provider-Used` tells you who served it. `X-Attempts` tells you how many were tried. More in
[how failover works](/docs/failover).

## What happens to my provider API keys?

Nothing, because they never leave your machine. Self-hosting is the only way to run Proxlane
today, so your keys are environment variables on your own box, read at boot and sent only to
the provider they belong to.

There is no Proxlane server in the request path. We cannot see them.

## What do you log?

One line per request to stdout, and you own the stdout.

It records the target's host, never the full URL, because URLs carry session tokens and API
keys, including the gateway's own `api_key`. No request body, no response body.
`PROXLANE_LOG_URLS=on` if you want full URLs. `PROXLANE_LOG=off` if you want none of it.

## What does it cost?

Nothing. There is no hosted endpoint and no billing. Bring your own keys, run it yourself, pay
your providers whatever you already negotiated. Proxlane adds nothing to that bill.

Hosted credits are planned but the rate is not settled, because charging only for unblocked
requests while the provider still bills us for blocked ones does not add up yet. BYOK and
self-host are unaffected either way.

## Which providers are supported?

The list lives in the [README's Providers table](https://github.com/proxlane/proxlane#providers).
It is not repeated here on purpose: that table is generated from the capability registry, so it
cannot claim a provider that does not exist. A number typed onto this page could.

Missing yours? An adapter is two functions, `translate` and `parse`. The packages you need are
Apache-2.0 so writing one does not pull you into copyleft. See
[bring your own provider](/docs/adapters).

## Do I need provider keys to contribute?

No. Contract tests replay recorded fixtures, so you can write an adapter and run
`pnpm conformance` with just Node, pnpm and Docker.

One thing so a skipped job does not look like your fault: the live canary cannot run on a fork
PR, because GitHub does not expose secrets there. A maintainer runs it on house keys before
merge.

## Can it download images, PDFs and other binary files?

Yes, with `binary=true`. The flag exists because getting this wrong is silent.

A provider that decodes a response as text returns 200 OK with a file that is the right length
in characters and the wrong length in bytes. We measured a 35 KB JPEG coming back as 64 KB,
with 14,807 replacement characters where the image used to be. Nothing short of comparing bytes
catches it.

So carrying bytes intact is a declared capability. `binary=true` routes only to providers that
have it, and returns `NO_PROVIDER_AVAILABLE` rather than a corrupt file.

## Is it production ready?

Parts of it. The gateway, failover, cooldowns, the detector and the shipped adapters are built
and tested.

The detector's rules started as vendor signatures. Five of the six have now been confirmed
against a real captured block page, and checking them was worth it: five of six turned out to
have a defect that only a real page could show. One could never match its own vendor's page,
because the signature is HTML-encoded there. One was unreachable behind another rule. One fired
on ordinary pages of protected sites, which would have failed over and charged you for a page
that was fine.

The sixth is `imperva-incapsula`. Its false positive is fixed, but nothing has captured it firing
on a real block yet, so it is not counted as confirmed. The
[Status section](https://github.com/proxlane/proxlane#status) is kept accurate rather than
aspirational, and a check fails the build when it drifts.

## What will it not do?

It will not scrape anything itself. It will not make an unblockable request, so if every
capable provider is blocked you get `NO_PROVIDER_AVAILABLE` instead of a retry loop. It will
not let an affiliate rate influence routing. And it will not call a blocked page a success to
make the numbers look better.
