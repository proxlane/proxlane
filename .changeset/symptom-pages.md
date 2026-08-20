---
'@proxlane/web': minor
---

Four symptom pages at `/symptoms/*`, answering the questions people actually search when a
scraper misbehaves: a 403, a 200 with a captcha in the body, a Cloudflare challenge surviving a
headless browser, and identifying a DataDome block. `content:lint` gates them against the
checklist `operating.md` already specified.
