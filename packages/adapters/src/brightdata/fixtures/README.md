# brightdata fixtures

Empty until `pnpm record --adapter=brightdata` runs against a trial key.

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
