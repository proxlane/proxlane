# scrapingbee fixtures

Recorded by `pnpm record --adapter=scrapingbee` against a trial key, and re-recorded the same way when
the weekly drift check reports the provider changed.

**Never hand-write a fixture.** CI cannot tell a recording from a fabrication — that check
does not exist and cannot be built — so this one is on you. A fabricated fixture makes the
entire contract-test layer decorative.

Fixtures are **post-transfer-decoding, pre-charset-decoding bytes plus all response
headers**. undici has already handled `content-encoding`; charset decoding has not
happened. If you are looking at a string rather than bytes, something is wrong.

The recorder drives a standard target matrix — success (HTML and JSON), target 404, target
5xx, timeout and renderJs — and sanitizes secrets before writing. Check anyway.

**There are no block or captcha fixtures here, and that is deliberate.** Neither can be
summoned from a stable target on demand, so a recorder claiming to produce them would write
a 200 labelled `block` — a fabrication with a plausible filename. Those come from real
traffic.

**`quota-exhausted.json` appears only when the plan runs out during `pnpm record`.** Recorded
2026-09-30 at 1,002 of 1,000 credits: `401 {"message":"Monthly API calls limit reached: 1000"}`,
the same status a wrong key gets, so the adapter reads the message to tell them apart.
Conformance asserts it still parses to `QUOTA_EXHAUSTED`. Not required, not aged, never replayed
as a target's answer; see `ACCOUNT_FIXTURES`.
