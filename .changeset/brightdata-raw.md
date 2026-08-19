---
'@proxlane/adapters': minor
---

The Bright Data adapter asks for `format: 'raw'` and can now return bytes. It used `json` because
"raw returns an API 200 whatever the target did" — true of the API's status line, but
`x-brd-status-code` carries the target's status on every raw response, so raw is a strict superset:
same outcomes, plus the original bytes and the target's real charset. Three of four adapters now
carry binary; ScraperAPI cannot, and says so.
