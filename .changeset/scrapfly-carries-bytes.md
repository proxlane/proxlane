---
'@proxlane/adapters': minor
---

Scrapfly is declared binary-capable, which it always was — it reports `result.format: 'binary'`
and base64-encodes the content, and the adapter already decoded that. The earlier `false` came
from measuring the provider's wire response instead of the adapter's output. Conformance now
asserts the `binary` flag against a recorded JPEG through `parse`, in both directions, and the
fixture is required of every adapter.
