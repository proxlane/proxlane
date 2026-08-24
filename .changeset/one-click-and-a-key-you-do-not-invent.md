---
'@proxlane/web': minor
---

One-click deploy, on two hosts, in their own colours. The homepage's first call to action is now a
thing that runs rather than a page that explains: a pinned image on the reader's own account, with
one provider key asked for. Render is free and sleeps after fifteen minutes idle; DigitalOcean is
about five dollars a month and stays awake, which for a scraper is often the one that matters. Each
price is printed on its button rather than discovered at a checkout. Docs and source are links
underneath rather than two more pills, so the row has one primary action per host and one baseline.

Both blueprints live in the repo — `render.yaml` and `.do/deploy.template.yaml` — so they can be
read before they are clicked, and both image tags are written by the release rather than by hand.

Both also set `PROXLANE_MAX_INFLIGHT=16`. The default of 32 sizes the gateway at 800 MB and these
instances are 512, so the boot check would have printed the arithmetic and exited rather than being
OOM-killed later. Correct behaviour, and a crash loop on the one plan the button selects.
