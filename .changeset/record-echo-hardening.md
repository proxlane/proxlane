---
"@proxlane/adapters": patch
---

The recorder refuses a fixture carrying any address outside a known-public place, wherever it sits in the text, including percent-encoded, entity-escaped or UTF-16, and redacts echoed addresses whatever their escaping, prefix or nesting, including in response headers.
