# Provider API research

Verified against official documentation on 2026-09-10. Provider catalogs and routing change frequently; re-check these links before release.

## OpenCode Zen

Zen is a multi-protocol gateway, not one OpenAI-compatible API. Its current catalog routes model families through these endpoints:

- OpenAI Responses: `https://opencode.ai/zen/v1/responses`
- Anthropic Messages: `https://opencode.ai/zen/v1/messages`
- OpenAI-compatible Chat Completions: `https://opencode.ai/zen/v1/chat/completions`
- Google-compatible models: `https://opencode.ai/zen/v1/models/<model-id>`
- Model catalog: `https://opencode.ai/zen/v1/models`

The current documented examples include GPT and Grok models on Responses, Claude and Qwen models on Messages, Gemini models on Google routes, and DeepSeek/MiniMax/GLM/Kimi models on Chat Completions. This confirms that Shade needs protocol metadata per model and cannot safely route all Zen models through its existing custom OpenAI-compatible provider.

The public models endpoint responds, but its JSON body was not inspectable through the research browser. The documentation calls it a source of full model metadata, but does not specify a stable response schema or guarantee which field declares image input. Treat the fetched catalog as untrusted cache data, validate its schema, and retain a small bundled fallback. Do not infer vision support from a vendor family or endpoint alone.

Authentication is by an OpenCode API key. OpenCode's official inference guide documents `Authorization: Bearer <token>` for its protocol endpoints. The Zen page itself does not separately spell out the wire-level authentication header, so verify a real Zen request before release.

Sources: [Zen overview, endpoint table, and model catalog](https://opencode.ai/docs/zen/), [OpenCode inference authentication and protocol examples](https://opencode.ai/console/guides/inference)

## OpenCode Go

Go is a separate subscription and endpoint family:

- OpenAI Responses: `https://opencode.ai/zen/go/v1/responses`
- Anthropic Messages: `https://opencode.ai/zen/go/v1/messages`
- OpenAI-compatible Chat Completions: `https://opencode.ai/zen/go/v1/chat/completions`
- Model catalog: `https://opencode.ai/zen/go/v1/models`

The current catalog mixes protocols. For example, Grok 4.6 and GPT 5.6 Luna use Responses; MiniMax M3/M2.7/M2.5 and Qwen models use Messages; GLM, Kimi, DeepSeek, MiMo, LongCat, and Hy models use Chat Completions. The documented model list may change.

Every Shade request would need:

- A client-specific `User-Agent`, such as `shade/<version>` rather than the SDK default.
- A stable `x-opencode-session` value for a conversation, reused across its main and auxiliary requests.
- The Go API key and Go-specific subscription/error handling.

There is a product-policy gate. OpenCode says Go is designed for OpenCode and other coding agents that send similar traffic, and that traffic is monitored for abuse. Shade is a general screen assistant, so the current documentation does not establish that normal Shade traffic is eligible. Ask OpenCode for confirmation before publicly enabling Go. Implementation can be prepared behind a disabled or experimental gate, but it should not ship as generally available based only on protocol compatibility.

The Go model endpoint was reachable but its response body/schema was not inspectable through the research browser. As with Zen, capability fields require live schema validation. The docs list `deepseek-v4-flash-vision-exp`, but do not independently certify image support for every other Go model.

Source: [Go eligibility, required client/session identity, endpoints, models, limits, and privacy](https://opencode.ai/docs/go/)

## Direct DeepSeek

The original plan's model list is stale. DeepSeek's current canonical models are:

- `deepseek-flash`: DeepSeek V4.1 Flash; supports vision.
- `deepseek-v4-pro`: DeepSeek V4 Pro; does not support vision and is scheduled to route to V4.1 Flash starting 2026-09-14 until V4.1 Pro is released.

Legacy names `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` are still accepted, but those models are retired and requests route to V4.1 Flash. Shade should display and store the canonical `deepseek-flash` ID and only retain legacy IDs for configuration migration.

Supported base URLs and protocols:

- OpenAI-compatible base: `https://api.deepseek.com` (`/chat/completions` and `/responses`)
- Anthropic-compatible base: `https://api.deepseek.com/anthropic` (`/messages`)
- Authentication: `Authorization: Bearer <DeepSeek API Key>`

For Shade's existing request shape, Chat Completions is the smallest initial adapter. `deepseek-flash` accepts JPEG, PNG, GIF, and WebP through an `image_url` content block using a base64 data URL, so Shade's compressed JPEG screenshots fit directly. Images are allowed in user messages only. Direct DeepSeek also supports image input through Responses and Anthropic-compatible Messages, but those protocols are unnecessary for the initial integration.

The official models endpoint is `GET https://api.deepseek.com/models`; it requires authentication. The list response establishes available IDs, but the documented model-list object does not establish per-model image support. Keep capability metadata from explicit official documentation in the bundled registry and use the live list for availability, not as the sole vision authority.

Sources: [current models, pricing, aliases, and retirement routing](https://api-docs.deepseek.com/quick_start/pricing/), [vision request format and restrictions](https://api-docs.deepseek.com/guides/vision/), [model-list API](https://api-docs.deepseek.com/api/list-models/), [first request and authentication](https://api-docs.deepseek.com/)

## Recommended initial scope

1. Add protocol and capability fields to Shade's provider/model registry before adding a provider. Keep bundled capability truth separate from fetched availability.
2. Implement Zen with one adapter per protocol. For the first usable screenshot path, start with its documented Chat Completions route and `deepseek-v4-flash-vision-exp`; then add Responses, Messages, and Google adapters deliberately. Do not expose models whose image capability has not been verified.
3. Implement direct DeepSeek Chat Completions with canonical `deepseek-flash` as the default and mark it vision-capable. Keep `deepseek-v4-pro` text-only and migrate legacy Flash IDs.
4. Prepare Go's header/session plumbing only after the common protocol layer exists. Keep Go unavailable to normal users until OpenCode confirms Shade's traffic is permitted.
5. Before release, make opt-in live checks for authentication, one text request, one screenshot request, streaming cancellation, and live model-catalog parsing. Paid live calls must stay out of the default test suite.
