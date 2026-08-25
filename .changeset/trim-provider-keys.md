---
'@proxlane/shared': minor
'proxlane': patch
---

Provider keys are trimmed when read from the environment. They were not, and the failure that
produced is silent and expensive.

`Headers` normalises TRAILING whitespace away, so a key ending in a space or a newline works —
which is most accidents, and it teaches you whitespace is harmless here. A LEADING space
survives: `Authorization: Bearer  <key>` goes out with two spaces, the provider answers 401, and
that reaches the caller as `AUTH_FAILED` — a taxonomy member meaning "your credential was
refused", pointing at the key's value when the value is correct and its framing is not.

Only one of the four adapters could show it. The other three put the key in a query string,
where `URLSearchParams` percent-encodes the space rather than sending it, so exactly one provider
looked broken and the rest looked fine — which is the most misleading shape this could have had.

`proxlane doctor` now says when a key had surrounding whitespace, because the gateway trimming it
does not stop the same value confusing someone comparing their `.env` against what they pasted.
