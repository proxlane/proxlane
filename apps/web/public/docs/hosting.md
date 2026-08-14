<!-- Source: https://proxlane.dev/docs/hosting — edit apps/web/content/docs/hosting.md -->
---
title: Hosting
summary: Where the gateway runs well, where it runs badly, and why.
---

The gateway is a stateless Node process. It needs outbound HTTPS and about a gigabyte of
memory. Anything that runs a container will run it.

What follows is ordered by how well it actually works.

## Requirements

To **run** the published image, all you need is Docker. Nothing else.

| | Version | Why |
|---|---|---|
| Docker | any current release | The only requirement for running the image |
| Memory | ~1 GB | See sizing below. This is the constraint that matters |
| Outbound HTTPS | required | The gateway calls provider APIs |

To **build from source or contribute**, the toolchain is pinned:

| | Version | Notes |
|---|---|---|
| Node | 24.19.0 | Pinned exactly in `.nvmrc`. Node 22 is in maintenance |
| pnpm | 10.34.5 | Pinned in `packageManager`. Not pnpm 11 |
| Docker | any current release | Needed for the test containers |

`pnpm bootstrap` checks all three against the pins and tells you which one is wrong before
installing anything.

You do **not** need provider API keys to contribute. Contract tests replay recorded fixtures,
so a clone, Node, pnpm and Docker are enough to run the full suite.

## Docker Compose

The supported path, and the one the project tests.

```bash
git clone https://github.com/proxlane/proxlane
cd proxlane
cp .env.example .env        # set PROXLANE_API_KEY and one provider key
docker compose -f docker/compose.yml --env-file .env up -d
```

Compose only passes through variables named in the file. Setting something in `.env` that
the compose file does not forward does nothing. If a setting seems to be ignored, that is
the first thing to check.

## A VPS or droplet

DigitalOcean, Hetzner, Linode and Scaleway all work the same way: install Docker, run the
Compose file, put a reverse proxy in front for TLS.

Point DNS at the box **before** you start the proxy. Caddy and certbot both answer an ACME
challenge on a name that must already resolve. Start them first and the challenge fails, and
some setups then back off for a while.

Two lines of Caddy is enough:

```
proxy.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

## Serverless platforms

Possible, with real limits. Check them against your traffic before committing.

The one that catches people is the request body cap. Several platforms cap responses at a
few megabytes, well under the gateway's 10 MB default. Scraped pages are larger than people
expect, especially rendered ones.

Long deadlines are the other. A rendered scrape with failover can legitimately run for a
minute. Platforms that cut execution short will cut it mid-chain.

Full detail, including the current Vercel constraints, is in
[self-hosting](https://github.com/proxlane/proxlane/blob/main/docs/self-hosting.md).

## Cloudflare Workers

**No.** Workers has no Node runtime and no undici.

That is not a small gap. Undici's per-origin connection pools with per-provider timeouts are
the reason this project runs on Node at all. On Workers the gateway would rebuild connections
constantly and could not honour a long terminal attempt.

The marketing site runs on Workers. The gateway does not.

## Running more than one

The gateway is stateless, so scaling out is just running more of them.

Cooldowns and health are the exception. By default they live in the process, so two gateways
would keep two opinions and route differently. Point both at Valkey and the state is shared:

```bash
PROXLANE_VALKEY_URL=redis://valkey:6379
```

Without it, the gateway refuses to start when `PROXLANE_REPLICAS` is greater than one. That
is deliberate. Refusing is better than quietly misrouting.

## Sizing

Memory is the constraint. The gateway buffers each response body before the detector can
read it, so plan for roughly:

```
PROXLANE_MAX_INFLIGHT × PROXLANE_BODY_CAP_MB × 2.5
```

At the defaults, 32 in flight and a 10 MB cap, that is about 800 MB.

Lower the concurrency ceiling on a smaller box rather than raising the memory cap and hoping.
Past the ceiling the gateway returns a clean 429. Past the memory limit it is killed.

This is not checked at boot yet. The arithmetic is yours to do.

## Checking a deployment

```bash
npx proxlane doctor
```

It reports what it checked, not just pass or fail, so the output is worth pasting into an
issue. `--json` gives the same thing in a parseable form.
