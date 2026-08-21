# Self-hosting proxlane

Every command here was run against a clean clone before it was written down. Where something
does not work, this says so rather than describing what ought to happen.

## What you are deploying

**One container.** The gateway, on port 8787, built from `node:24.19.0-alpine`, running as a
non-root `proxlane` user. The image is about 244 MB.

There is no database, no queue, no dashboard and no worker, because none of them exist yet.
Valkey ships commented out in the compose file: it is what lets you run more than one gateway,
and a single one does not need it.

## Before you start

| | |
|---|---|
| **Required** | Docker with Compose v2, and a `PROXLANE_API_KEY`. The gateway **refuses to boot** without the key — a gateway started open is a proxy funded by whoever deployed it |
| **Optional** | Provider keys. All three are optional and none is a valid configuration: the gateway boots, warns, and answers `NO_PROVIDER_AVAILABLE` rather than crash-looping someone who has not signed up yet |

You do not need Postgres, Valkey, or a Node toolchain to run it.

## 1. Docker Compose — the supported path

```bash
git clone https://github.com/proxlane/proxlane
cd proxlane
cp .env.example .env

openssl rand -hex 32          # paste the result as PROXLANE_API_KEY in .env
$EDITOR .env                  # and add whichever provider keys you have

docker compose -f docker/compose.yml --env-file .env up -d
```

**`--env-file .env` is not optional, and this is the one thing most likely to trip you up.**
Compose takes its project directory from the location of the first `-f` file, so with the
compose file under `docker/` it looks for `docker/.env` and never reads the `.env` you just
created at the repo root. Without the flag you get:

```
required variable PROXLANE_API_KEY is missing a value
```

`--project-directory .` works too. Pick one; do not omit both.

No `--build`: Compose pulls the **pinned** gateway image from the registry even though the
compose file also declares a `build:`, because Compose v2 prefers a resolvable image. The tag is
in `docker/compose.yml` and is a specific version, never `:latest` — `operating.md` B8 says the
pin is the supported choice and `:latest` is the unstable one. This paragraph said `:latest` for
as long as the file said otherwise, and the file was five minors behind besides, so a reader
following it got a gateway that predated most of the headers the API reference describes.
`repo:check` assertion 30 now holds the pin to the newest release.

The build path is still there if you want it — add `--build`.

### Check it came up

```bash
curl -s localhost:8787/health
# {"status":"ok","providers":0}
```

`providers` counts the provider keys the gateway actually loaded. If you set keys and see `0`,
they are not reaching the container — the compose file only forwards variables it names
explicitly in its `environment:` block.

```bash
KEY=$(grep '^PROXLANE_API_KEY=' .env | cut -d= -f2)

# Unauthenticated requests are refused.
curl -s -o /dev/null -w '%{http_code}\n' localhost:8787/v1?url=https://example.com
# 401

# Authenticated, with no provider keys set, this is the correct answer:
curl -si -H "authorization: Bearer $KEY" 'localhost:8787/v1?url=https://example.com' | head -5
# HTTP/1.1 503
# x-outcome: NO_PROVIDER_AVAILABLE
# x-outcome-class: gateway
# x-attempts: 0
```

`x-attempts: 0` is the point: `NO_PROVIDER_AVAILABLE` means the chain was empty, not that every
provider failed. An exhausted chain reports the last provider's outcome instead.

### The endpoints

| Path | Auth | For |
|---|---|---|
| `GET /health` | none | Load balancer and uptime probes. Deliberately open so a probe needs no secret |
| `GET /health/cooldowns` | **yes** | Which provider/domain pairs are cooling off |
| `GET /health/providers` | **yes** | Provider health states, when `PROXLANE_HEALTH=on` |
| `GET` / `POST /v1` | **yes** | The gateway itself |

## 2. A VPS or droplet — DigitalOcean, Hetzner, Linode, Scaleway

Identical to the above; a droplet is just a machine with Docker on it. What changes is what
surrounds it.

**Do not build on a small box.** The published image is public, so the compose file above pulls
rather than builds and this mostly takes care of itself. If you do build — a fork, a patch —
build elsewhere and push to your own registry, or build once and `docker save` / `docker load`.
Compiling the monorepo will strain a 1 GB droplet, a failure this project has already had on
its own infrastructure.

**Do not expose 8787.** Bind it to loopback and put a reverse proxy in front for TLS. In
`docker/compose.yml`:

```yaml
ports:
  - '127.0.0.1:8787:8787'     # instead of '${PORT:-8787}:8787'
```

Then Caddy, which is two lines and gets you a certificate:

```
proxy.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

**Point DNS at the box before you start the proxy.** Caddy and nginx-with-certbot both need to
answer an ACME challenge on a name that already resolves; starting them first fails the
challenge and some setups then back off for a while.

**Sizing.** Memory is the constraint. The gateway buffers each response body before the
detector can read it, so the working set is roughly
`PROXLANE_MAX_INFLIGHT * PROXLANE_BODY_CAP_MB * 2.5`. At the defaults — 32 in flight, 10 MB
body cap — that wants roughly 800 MB for the container. Lower `PROXLANE_MAX_INFLIGHT` on a
smaller box rather than raising the cap and hoping.

Past the ceiling the gateway answers **429 `GATEWAY_BUSY`** with `Retry-After` and sheds the
request. It does not queue: a queued scrape holds its client's socket while its own deadline
runs down, and the queue itself is memory this ceiling exists to bound. `/health` is never
shed, so an orchestrator will not restart a gateway whose only problem is that it is busy.

**This is checked at boot.** The gateway reads the container's memory limit and refuses to
start if the arithmetic does not fit, printing both numbers and the ceiling that would:

```
  This gateway is configured to need about 800 MB, and the container memory limit (cgroup v2)
  is 512 MB. It would be OOM-killed under load rather than answering 429.

      32 x 10 x 2.5 = 800 MB needed, 512 MB available

  Either lower the ceiling:   PROXLANE_MAX_INFLIGHT=20
  or give the container more memory.
```

It reads cgroup v2, then v1, and never falls back to total system memory: inside a limited
container that reports the host's, which is the hole the check exists to close.

When no limit is readable, which is normal outside a container, it prints the arithmetic and
starts anyway. Set `PROXLANE_MEMORY_LIMIT_MB` to have it checked. That variable also overrides
a limit that is readable, so an operator who finds the 2.5 factor too conservative states a
real number rather than switching the check off.

`npx proxlane doctor` reports the same budget from the same code, so it cannot tell you
everything is fine about a gateway that will refuse to start.

`restart: unless-stopped` is already set, so the container survives a reboot.

## 3. Vercel — possible since June 2026, with three real constraints

**This page previously said the gateway did not belong on Vercel. That was wrong**, and the
argument it rested on was wrong too: Vercel added Dockerfile deploys on 30 June 2026, and the
duration limit I claimed would break it does not exist. Hobby allows 300 s, which is well past
this gateway's 120 s default deadline.

You add a `Dockerfile.vercel` that listens on `$PORT`; Vercel builds it, stores it in its
container registry, and runs it as an HTTP-backed function on Fluid compute. Our Dockerfile
already reads `PORT`, so it is close to a drop-in.

Three constraints do bite, and the first is the one that will actually catch you:

**1. The 4.5 MB body cap.** Vercel caps request AND response bodies at 4.5 MB, returning
`413 FUNCTION_PAYLOAD_TOO_LARGE` past it. Proxlane's default `PROXLANE_BODY_CAP_MB` is **10**,
and a scraping gateway exists to return page bodies. Set it to 4 or lower:

```
PROXLANE_BODY_CAP_MB=4
```

Otherwise every large page becomes a platform error rather than a proxlane outcome, which is
precisely the kind of unexplained failure the outcome taxonomy exists to prevent.

**2. Autoscaling means many instances, and cooldowns are in-process.** Vercel scales to 30,000
concurrent executions. Each instance keeps its own view of which providers are cooling off, so
a provider that just refused one instance is retried immediately by the next. Set
`PROXLANE_VALKEY_URL` to a managed Valkey or Redis.

The gateway already refuses to boot when `PROXLANE_REPLICAS > 1` without Valkey, and an
autoscaling fleet is that case whether or not you set the variable. Treat the refusal as the
design telling you the truth.

**3. Scale to zero.** Idle instances are reclaimed, so the first request after a quiet period
pays a cold start and rebuilds undici's per-origin pools — the pools that are the reason this
project runs on Node at all. Warm instances reuse them; a fleet that is constantly cycling does
not. If your traffic is bursty and latency-sensitive, a small always-on machine still wins.

Also worth knowing: **1,024 file descriptors are shared across concurrent executions** on an
instance, and every provider connection consumes one. Keep `MAX_INFLIGHT` modest.

Memory is not a problem: Hobby gives 2 GB against the roughly 800 MB the boot check wants at
default settings.

**The marketing site (`apps/web`) is an ordinary TanStack Start app** and none of the above
applies to it. It deploys to Cloudflare Workers from `.github/workflows/deploy-web.yml`; Vercel
would work equally well.

## Putting it behind a domain

Optional, and worth doing carefully because the gateway is a proxy: whatever can reach it and
holds the key can fetch any URL through your provider accounts, on your bill.

```
api.example.com   A   <your host>   DNS only
```

**DNS only, not proxied.** Every request through a CDN or reverse proxy you do not control means
that party sees the URL you are scraping and the bytes that came back. That is the opposite of
what self-hosting is for, and the gateway's own promise — nothing phones home, the only hosts it
contacts are your provider and your target — stops being true of your deployment.

There is a practical reason too. A rendered scrape can legitimately take a minute; the whole
chain is budgeted to 120 seconds by default and a terminal hop alone may take 90. Proxies impose
their own request ceilings, often around 100 seconds, and when one trips you get its timeout page
instead of an outcome — losing exactly the diagnosis the gateway exists to give you.

If you put it on a public hostname:

- **`PROXLANE_API_KEY` is now the only thing between the internet and a working proxy.** Make it
  a fresh `openssl rand -hex 32` used nowhere else, and rotate it if it ever appears in a log,
  a shell history or a CI job.
- The edge guard becomes load-bearing. It refuses private ranges and cloud metadata by every
  spelling the URL parser accepts (`pnpm test:ssrf`), but it is not an authorisation system:
  anyone with the key can aim the gateway at anything public.
- Restrict by source address at your reverse proxy if only your own machines need it. That gives
  up nothing except convenience.

`GET /health` needs no key and reports the running version, so it is safe to leave reachable and
is what a deploy or an uptime check should watch.

## 4. Running more than one gateway

Cooldowns and health live in the process by default. `PROXLANE_REPLICAS > 1` **refuses to
boot** unless you give it somewhere shared to put that state:

```bash
PROXLANE_VALKEY_URL=redis://valkey:6379
PROXLANE_REPLICAS=2
```

Uncomment the `valkey` service in `docker/compose.yml`. It runs without persistence on purpose
— everything in it is reconstructible, and losing it costs a wasted attempt, not correctness.

## Environment

`.env.example` is exhaustive and authoritative; boot parses it with Zod and fails fast, so an
undocumented variable is a startup crash rather than a runtime surprise. The ones that matter
most:

| Variable | Default | Notes |
|---|---|---|
| `PROXLANE_API_KEY` | none | **Required.** Refuses to boot without it |
| `SCRAPERAPI_KEY` `SCRAPINGBEE_KEY` `SCRAPFLY_KEY` `BRIGHTDATA_KEY` | none | BYOK. All optional. Bright Data's is `<zone>:<token>` |
| `PORT` | `8787` | |
| `PROXLANE_DEADLINE_MS` | `120000` | Global per-request deadline |
| `PROXLANE_BODY_CAP_MB` | `10` | Response body cap |
| `PROXLANE_MAX_INFLIGHT` | `32` | Concurrent `/v1` requests, then 429 `GATEWAY_BUSY` |
| `PROXLANE_MEMORY_LIMIT_MB` | unset | Declares the memory limit when no cgroup one is readable |
| `PROXLANE_TERMINAL_RETRIES` | `1` | Extra goes at the **last** provider only, on `PROVIDER_ERROR` and `PROVIDER_TIMEOUT`. `0` disables, max 10 |
| `PROXLANE_LOG` | on | One NDJSON line per `/v1` request to stdout. `off` to silence |
| `PROXLANE_LOG_URLS` | off | Log the full target URL rather than its host. Query strings carry credentials |
| `PROXLANE_COOLDOWNS` | on | Set `off` to disable |
| `PROXLANE_HEALTH` | **off** | Set `on` to enable provider health. Off by default because its calibration is not yet validated against real traffic |
| `PROXLANE_VALKEY_URL` | unset | Shared state, required for more than one replica |
| `PROXLANE_REPLICAS` | `1` | Refuses to boot above 1 without Valkey |

A variable set in `.env` reaches the container only if `docker/compose.yml` names it in its
`environment:` block. If something appears to have no effect, check there first.

## Diagnosing

```bash
npx proxlane doctor            # environment, keys, egress, state store, cooldowns
npx proxlane doctor --json     # paste this into an issue
```

`doctor` inspects the machine it runs on, not a remote gateway, so run it where the container
runs. Every command in the CLI takes `--json`.

## Upgrading

```bash
git pull
docker compose -f docker/compose.yml --env-file .env up -d
```

The gateway is 0.x. Breaking changes are minor bumps until `GatewayRequest` and the outcome
taxonomy have gone two consecutive releases unchanged; read the changelog before upgrading.

## Known gaps

Recorded because they affect anyone following this page, not to be tidied away:

- **`pnpm selfhost:smoke` does not exercise this path.** It injects `PROXLANE_API_KEY` through
  the process environment instead of reading `.env`, so it passes while the documented
  `--env-file` behaviour above goes unchecked. The check and the instructions test different
  things.
