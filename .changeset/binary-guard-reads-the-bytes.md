---
'@proxlane/adapters': patch
---

The conformance binary check no longer passes a corrupt file whose magic bytes happen to be
printable. WebP is "RIFF", PDF is "%PDF", ZIP and XLSX are "PK", GIF is "GIF8" — all survive a
UTF-8 round trip intact while the rest of the file is destroyed, so a magic-only check went quiet
on every one of them. It now also counts U+FFFD replacement characters, whose presence in a
binary body is the corruption itself, whatever the format.
