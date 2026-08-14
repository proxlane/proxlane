---
"@proxlane/shared": minor
"@proxlane/gateway": minor
"proxlane": minor
---

Check at boot that the gateway fits in the memory it has been given. It reads the container's
limit from cgroup v2 then v1, and refuses to start when `maxInflight * bodyCap * 2.5` exceeds
it, printing both numbers and the ceiling that would fit. It never falls back to
`os.totalmem()`, which reports the host's memory inside a limited container.

When no limit is readable, which is normal off a container, it prints the arithmetic and
starts, so `pnpm dev` still works. `PROXLANE_MEMORY_LIMIT_MB` declares a limit where there is
none and overrides one where there is. `proxlane doctor` reports the same budget from the same
code. `.env.example` and `docs/self-hosting.md` described this check for months before it
existed; both now describe what it does.
