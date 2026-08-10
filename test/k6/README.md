# Load harness

Empty on purpose. `test/k6/soak.js` is devex-engineer's to build and platform-engineer's
exit criterion to run — construction is parallel, verification is serial.

It cannot be written usefully yet: the threshold is p95 of **gateway-internal** time from a
`Server-Timing` header the gateway does not emit, so a harness written now would measure
end-to-end latency against a mock, which measures nothing.

Needs, when it lands: 50 VUs, 30 minutes, `Server-Timing: gw;dur=` parsed for p95, an RSS
slope threshold from minute 10, and a 429 assertion at `maxInflight`.

**Where it runs is an open decision.** The deployment box sits at ~66% CPU pressure and
~51% IO pressure during normal scrape windows, so a p95 gate measured there is measuring the
neighbours. Run it on a dedicated ephemeral box, or restate the threshold honestly — but
not in a quiet window reported as the number.

k6 is a Go binary (`brew install k6`), not an npm package. The npm `k6` is a 0.0.0
placeholder, which is why it has no row in the pinned-toolchain table.
