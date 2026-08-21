---
'@proxlane/shared': patch
---

The edge guard now refuses three IPv6 forms that carried an IPv4 address past it: RFC 2765's
IPv4-translated `::ffff:0:0/96`, RFC 8215's local-use NAT64 prefix `64:ff9b:1::/48`, and the five
RFC 6052 embedding positions other than the well-known one. `http://[::ffff:0:169.254.169.254]/`
reached the cloud metadata endpoint.
