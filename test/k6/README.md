# Load harness

`pnpm k6:soak` runs `operations.md` section 9's launch gate: 50 VUs for 30 minutes against a
local mock provider, asserting p95 of gateway-internal time, no memory growth, and that the
concurrency ceiling sheds.

```bash
brew install k6          # a Go binary, not an npm package
pnpm k6:soak

# a two-minute smoke, for checking the harness itself
SOAK_VUS=10 SOAK_DURATION=100s SOAK_MAX_INFLIGHT=16 pnpm k6:soak
```

## What is in here

| | |
|---|---|
| `mock-provider.ts` | an upstream that returns slow responses, 429s, huge bodies and challenge pages on demand |
| `harness.ts` | the real `createApp` wired to the mock, over a real socket |
| `soak.js` | the k6 script. Plain JS: k6 embeds its own runtime, not Node |
| `../../scripts/k6-soak.ts` | starts both, runs k6, samples RSS, asserts, tears down |

## Why a mock and not real providers

The gate is p95 of **gateway-internal** time, which explicitly subtracts provider latency. Real
providers cannot improve that measurement, only add variance and cost — tens of thousands of
billed requests against three partners, per run. And the failure modes have to be available on
demand: waiting for a provider to organically return a 429 is not a test.

The mock is not a fixture. Fixtures are recorded provider traffic replayed by the conformance
suite and are never hand-written. Nothing here is claimed to be a recording. The one thing it
does borrow from reality is the Cloudflare challenge signature, because a block page the real
detector ignores would measure the wrong code path.

## What is asserted

- **p95 of `Server-Timing: gw;dur=` under 50 ms**, over requests the gateway **served**. Shed
  requests are excluded: they are refused before a provider is chosen and cost ~0.02 ms, so
  including them dragged the p95 to 0.00 ms and the gate passed regardless of real latency.
- **p95 of shed responses under 5 ms.** Refusing has to stay cheap, or the gateway gets slower
  exactly when it is under most pressure.
- **RSS slope under 0.5 MB/min, measured from minute 10.** Earlier samples are heap warm-up: a
  110-second run measured 1.73 MB/min on a gateway with no leak. A run shorter than ten minutes
  reports the slope and does not assert on it.
- **The burst scenario sees 429s**, and every one carries `GATEWAY_BUSY` and `Retry-After`.
- **At least 100 timed samples.** A run that measured nothing must not pass.

## Where it runs is still an owner decision

The deployment box sits at roughly 66% CPU and 51% IO pressure during normal scrape windows.
Gateway-internal time excludes network but fully includes event-loop starvation, so a p95
measured there is measuring the neighbours.

This harness removes the *other* half of that problem — provider variance — so the number now
depends only on the machine. Run it somewhere quiet, or restate the threshold honestly. Not in
a quiet window reported as the number. `docs/state.md` tracks the decision.

k6 is not in the pinned-toolchain table: the npm package is a `0.0.0` placeholder, and a row
needs an assertion behind it, which would fail `repo:check` from a clean clone. `k6:soak`
reports its absence instead.
