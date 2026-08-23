# @proxlane/sdk

**This is a placeholder. There is no SDK yet.** The published version exports one string constant
and nothing else — it exists to hold the name.

You do not need one. [Proxlane](https://proxlane.dev) is one GET:

```bash
curl "http://localhost:8787/v1?api_key=$PROXLANE_API_KEY&url=https://example.com"
```

The response headers tell you what happened: `X-Outcome`, `X-Provider-Used`, `X-Chain`,
`X-Detect-Rule`, `X-Cost-Estimate`, `X-Cost-Source`. The full reference is at
**[proxlane.dev/docs/api](https://proxlane.dev/docs/api)**, and there is an OpenAPI spec at
[proxlane.dev/openapi.json](https://proxlane.dev/openapi.json) if you would rather generate a
client than write one.

If and when an SDK is worth having, it will be announced in the
[repository](https://github.com/proxlane/proxlane). Until then this package is not something to
install.
