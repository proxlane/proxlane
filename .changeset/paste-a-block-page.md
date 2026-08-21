---
'@proxlane/web': minor
'@proxlane/detect': patch
---

A block page detector at `/block-page-detector`. Paste a response body and it runs the gateway's
own detector in your browser, names the rule that fired, and reads the consequence out of the
same policy table the router uses. Nothing is sent anywhere. `@proxlane/detect` now exports
`SCAN_BYTES`, so a caller can say how much of a body a verdict was formed from.
