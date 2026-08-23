# @proxlane/detect

Soft-block detection for scraped responses: **the HTTP 200 that is really a captcha, a challenge
page or an interstitial.** Part of [Proxlane](https://proxlane.dev). Apache-2.0.

A provider returns 200 and reports success. The body is a Cloudflare challenge. Every layer above
counts it as a scrape that worked, and the number that matters — how often you actually got the
page — quietly stops meaning anything.

```ts
import { detect } from '@proxlane/detect';

const verdict = detect(bodyBytes, contentType, charset);
// { blocked: true, ruleId: 'cloudflare-challenge' }
```

## What makes it worth trusting

Every rule carries the capture that confirms it. `verified.ts` is generated from a corpus of real
block pages, not written by hand, and it records which rules have actually fired against one and
which have not.

That distinction earned its place: five of the six rules had a defect only a real page could
show — one was unmatchable because the vendor entity-encodes a dot, one was unreachable behind an
earlier rule, one fired on ordinary pages, and one keyed on a parameter that rotates.

Rules that no capture has confirmed say so rather than being presented as equal.

## The rule ID travels

Proxlane attaches it to the response as `X-Detect-Rule`, so a block is inspectable rather than a
verdict you have to take on faith. Detection is table stakes in this category; showing you the
rule that fired is not.
