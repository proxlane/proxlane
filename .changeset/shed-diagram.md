---
"@proxlane/route-viz": minor
"@proxlane/web": minor
---

Draw the chain that never entered a lane. A route with no attempts used to render as a dot
and the word `request`, which reads as a broken drawing rather than as a request the gateway
refused before choosing a provider. It now runs in ink to a stop mark and labels the outcome:
ink is already the colour of a request that belongs to no provider, so the vocabulary says
what happened before a label is read.

The outcome gutter widens for `429 GATEWAY_BUSY`, now the longest terminus label at 16
characters. The previous sizing was cut to `PROVIDER_ERROR` and would have clipped the new
one on both widths.

The landing page gains the shed scenario and shows `server-timing` in the response readout,
which the gateway emits on every response and the page did not mention.
