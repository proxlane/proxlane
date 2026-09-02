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

**There is no `account-exhausted` fixture either, and that one is a judgement call rather
than an impossibility.** The account really was at 0/1000 on 2026-09-02, so it could have
been recorded — but the outcome is decided by the status code alone (403 with no
`sa-statuscode` is the spent cycle; 401 is the key), and `index.unit.test.ts` pins exactly
that. A recording would add bytes no assertion reads.

The risk that leaves is narrow and named: if ScraperAPI ever starts sending `sa-statuscode:
403` on an exhausted account, the adapter would read it as the *target's* 403 and call it
`HARD_BLOCK`. No fixture catches that, because a fixture recorded today would show the shape
that is correct today. The live canary is what catches it, which is the division of labour
those two layers already have.
