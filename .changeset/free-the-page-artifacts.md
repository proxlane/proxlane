---
'@proxlane/web': patch
---

`Panel`, `Transcript` and `CopyButton` move out of the landing-page route into
`components/artifacts.tsx`, so a second page can use them. Pure move, no visual change. They
also get their first tests, which is only possible now that something can import them.
