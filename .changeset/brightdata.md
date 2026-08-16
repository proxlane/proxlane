---
"@proxlane/adapters": minor
---

Add a Bright Data Web Unlocker adapter, the fourth provider and the first for a service this
project does not itself pay for. It reads the target's real status out of the JSON envelope
rather than the raw body, and decodes Bright Data's own `x-brd-error-code` so a dead target is
not blamed on the provider.

Two pieces of shared tooling assumed a provider's parameters live in the URL, which was true
of the first three by coincidence. The conformance suite and the replay transport now read the
request body too, and the recorded-target matrix moved off a Cloudflare-fronted host that an
unblocking provider correctly refuses to pass through.
