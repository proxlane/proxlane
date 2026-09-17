# scraperapi fixtures

Empty until `pnpm record --adapter=scraperapi` runs against a trial key.

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

**`quota-exhausted.json` appears only when a plan runs out during `pnpm record`.** The recorder
writes the refusal there instead of over the category it interrupted, and conformance asserts
it still parses to `QUOTA_EXHAUSTED`. It is not required, because nothing summons it, and it
is exempt from the fixture age check for the same reason. The replay harness never serves it.

The mapping it backs: a 403 with no `sa-statuscode` is the spent cycle, and 401 is the key.
If ScraperAPI ever starts sending `sa-statuscode: 403` on an exhausted account, the adapter
would read it as the *target's* 403 and call it `HARD_BLOCK`. A fixture recorded today shows
today's shape, so the live canary is what catches that: it stops exempting the provider and
goes red.
