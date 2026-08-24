---
'proxlane': patch
'@proxlane/web': patch
---

The Quickstart now starts a gateway before telling you to call one. "Get started" is the site's
primary call to action and it lands here; the page opened by asking the reader to curl
`https://your-gateway/…`, a placeholder that resolves to nothing, and only explained how to have
a gateway eighty lines further down. It never mentioned `localhost` at all, so the address you
would actually call appeared nowhere on the page. Order is now: start it, call it, migrate, move
the key out of the query string.

`proxlane doctor` fails when no provider key is set. Each per-key check stays green when absent,
because BYOK means you bring the providers you use and flagging the three you do not have trains
people to skip the output. Applied to *every* key, that produced "13 checks, all good" for a
gateway that cannot route one request. Zero keys is a different condition from one missing key,
and now it has its own check with a fix line.
