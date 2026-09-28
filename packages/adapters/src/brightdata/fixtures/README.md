# brightdata fixtures

Recorded by `pnpm record --adapter=brightdata` against a trial key, and re-recorded the same way when
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

**`auth-failed.json` appears only when the account refuses during `pnpm record`.** Recorded
2026-09-28 from a suspended account: HTTP 200, an empty body, `x-brd-status-code: 407` and
`x-brd-err-code: client_10020`, a header family the adapter did not read until then, so it
parsed as OK. The recorder writes a refusal there instead of over the category it interrupted,
and conformance asserts it still parses to `AUTH_FAILED`. Not required, not aged, never replayed
as a target's answer; see `ACCOUNT_FIXTURES`.
