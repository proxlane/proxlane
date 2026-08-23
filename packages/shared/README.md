# @proxlane/shared

The outcome taxonomy, the request shape and the SSRF edge guard shared by the
[Proxlane](https://proxlane.dev) gateway and every adapter. Apache-2.0.

You probably do not want to depend on this directly — it exists so `@proxlane/adapters`,
`@proxlane/detect` and the gateway cannot disagree about what happened to a request.

## The outcome taxonomy

The one thing worth reading. Every request ends in exactly one outcome, and the outcome decides
everything downstream: whether the chain fails over, whether the caller is billed, which cooldown
is armed, and what HTTP status comes back.

```ts
import { carriesBody, FAILOVER, policyFor } from '@proxlane/shared/outcome';

policyFor('SOFT_BLOCK');   // { httpStatus: 502, failover: true, chargeable: false, … }
carriesBody('TARGET_NOT_FOUND');  // true — a 404 is the target's real answer, body included
```

`Outcome` is open so an adapter can add one; `OutcomeClass` is closed at six members so nothing
downstream has to guess. A new outcome must declare its failover and cooldown behaviour to
compile, which is why adding one cannot silently miss the router.

## The edge guard

`guardTargetUrl` refuses a target before a request is paid for: private ranges, loopback, cloud
metadata, and the IPv6 forms that carry an IPv4 address in disguise — mapped, translated, and
every NAT64 embedding position RFC 6052 defines.
