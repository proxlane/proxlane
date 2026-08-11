---
'@proxlane/gateway': patch
---

The probe settlement fix was incomplete: it marked a claim settled whenever any cooldown key was written, so eight of sixteen outcomes stranded a probe when the claimed and written keys were in different namespaces — including a successful probe on an account cooldown, which took a working provider out of service. A lost probe claim now also re-ranks the chain, so the demoted floor can still see a usable fallback.
