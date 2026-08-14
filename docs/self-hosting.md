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

docker compose -f docker/compose.yml --env-file .env up -d --build
```

**`--env-file .env` is not optional, and this is the one thing most likely to trip you up.**
Compose takes its project directory from the location of the first `-f` file, so with the
compose file under `docker/` it looks for `docker/.env` and never reads the `.env` you just
created at the repo root. Without the flag you get:

```
required variable PROXLANE_API_KEY is missing a value
```

`--project-directory .` works too. Pick one; do not omit both.

`--build` is needed today because the published image is not yet public — see
[Known gaps](#known-gaps).

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

**Do not build on a small box.** The build compiles the whole monorepo and will strain a
1 GB droplet. Build elsewhere and push to your own registry, or build once and `docker save` /
`docker load`. This is the failure this project has already had on its own infrastructure.

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

**Sizing.** Memory is the constraint, and the gateway checks it at boot: it asserts
`MAX_INFLIGHT * BODY_CAP_MB * 2.5 < available`, reading the cgroup v2 limit. At the defaults
(32 in flight, 10 MB body cap) that wants roughly 800 MB for the container. Lower
`MAX_INFLIGHT` on a smaller box rather than raising the limit and hoping.

If no cgroup limit is readable — which is normal outside a container — set
`PROXLANE_MEMORY_LIMIT_MB` explicitly. The check deliberately does not fall back to
`os.totalmem()`, because inside a limited container that reports the host's memory and would
reopen the hole the check exists to close.

`restart: unless-stopped` is already set, so the container survives a reboot.

## 3. Vercel, and other serverless hosts — not for the gateway

**The gateway is a stateful long-running service and does not belong on a serverless host.**
This is a straight answer rather than a missing guide:

- **Connection pools do not survive.** The whole reason this project runs on Node rather than
  Bun is undici's per-origin pools with per-provider timeouts. A function that is frozen
  between invocations rebuilds them constantly, which costs exactly the latency the pools exist
  to avoid.
- **The requests are too long.** The default global deadline is 90 s and a terminal hop is
  budgeted up to 70 s. That exceeds the function duration available on Vercel's Hobby tier.
- **Cooldown state is in-process by default.** Each invocation would start with an empty view
  of which providers are cooling off, so a blocked provider gets retried immediately, every
  time. You can move that to Valkey with `PROXLANE_VALKEY_URL` — but at that point you are
  running a stateful service and paying for a serverless wrapper around it.
- **The boot memory check** expects a cgroup limit or an explicit `PROXLANE_MEMORY_LIMIT_MB`.

Use a machine: a droplet, a small VPS, Fly.io, Railway, Render, or anything else that runs a
container continuously. **The marketing site (`apps/web`) is an ordinary TanStack Start app and
deploys to Vercel fine** — it is only the gateway that does not fit.

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
| `SCRAPERAPI_KEY` `SCRAPINGBEE_KEY` `SCRAPFLY_KEY` | none | BYOK. All optional |
| `PORT` | `8787` | |
| `PROXLANE_DEADLINE_MS` | `90000` | Global per-request deadline |
| `PROXLANE_BODY_CAP_MB` | `10` | Response body cap |
| `MAX_INFLIGHT` | `32` | Concurrency ceiling; feeds the boot memory check |
| `PROXLANE_MEMORY_LIMIT_MB` | unset | Required when no cgroup limit is readable |
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
docker compose -f docker/compose.yml --env-file .env up -d --build
```

The gateway is 0.x. Breaking changes are minor bumps until `GatewayRequest` and the outcome
taxonomy have gone two consecutive releases unchanged; read the changelog before upgrading.

## Known gaps

Recorded because they affect anyone following this page, not to be tidied away:

- **`ghcr.io/proxlane/gateway` is not publicly pullable.** The release workflow pushes it, but
  the package is private, so an anonymous pull gets a 403 and `--build` is mandatory. Making
  the GHCR package public removes the build step for everyone.
- **`pnpm selfhost:smoke` does not exercise this path.** It injects `PROXLANE_API_KEY` through
  the process environment instead of reading `.env`, so it passes while the documented
  `--env-file` behaviour above goes unchecked. The check and the instructions test different
  things.
