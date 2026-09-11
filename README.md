# Shade

**Your screen, smarter.**

Shade is a Windows desktop assistant that stays in a translucent, always-on-top overlay. Ask a question, attach your screen when useful, and get streaming answers from your choice of cloud or local model.

![Version](https://img.shields.io/badge/version-0.15.1-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Screen-aware chat:** attach a screenshot manually or capture automatically when sending a message.
- **Compact overlay:** collapse, expand, move, and resize the window without leaving your work.
- **Cloud and local providers:** switch providers and models from Configuration or the model switcher.
- **Screenshot capability labels:** Zen, Go, and DeepSeek models show whether they support screenshots; unsupported image requests are blocked before sending.
- **Streaming responses:** read answers as they arrive and stop generation when needed.
- **Rich formatting:** Markdown, syntax-highlighted code, and LaTeX math.
- **Saved conversations:** browse, search, rename, and resume sessions from the Dashboard.
- **Prompt modes:** use built-in prompts or create your own, with optional provider/model overrides.
- **Conversation memory:** configure recent history and optional summarization for longer chats.
- **Local settings:** manage keys, screenshot history, memory, and updates in the app.

## Install

Download the Windows installer from [Releases](https://github.com/MichaelT025/Shade/releases), run it, and launch Shade. Node.js is not required for the installer.

Windows 10 version 2004 or later and Windows 11 are the supported targets. This branch does not include the separate Linux/Wayland port. Some macOS compatibility code exists, but packaged macOS releases are not an official target.

The README describes the code in this branch; published releases may not yet include all listed providers.

## Connect a provider

1. Open the **Dashboard**, then **Configuration**.
2. Select a provider, paste its API key if required, and click **Save**.
3. Use **Test key** to check access. For Zen, Go, and DeepSeek, this sends a small text request and can consume credits or subscription allowance.
4. Select a model. Use the model refresh control to fetch available models.
5. For screen questions, choose an image-capable model. Zen, Go, and DeepSeek display **Screenshots supported**, **Text only**, or **Screenshot support unverified**.
6. Return to the overlay and send a message. Optionally choose or customize a mode in the Dashboard.

Shade has no subscription of its own. Hosted providers require their own API access, billing, or subscription; local providers require a running model server.

| Provider | Setup in Shade |
| --- | --- |
| Google Gemini | Save a Gemini API key and select an available model. |
| OpenAI | Save an OpenAI API key and select an available model. |
| Anthropic Claude | Save an Anthropic API key and select a Claude model. |
| Grok (X.AI) | Save an X.AI API key. |
| OpenRouter | Save an OpenRouter API key. |
| OpenCode Zen | Save an OpenCode key. Shade routes each model through its appropriate API format. |
| OpenCode Go | Save your Go-enabled OpenCode key. Shade sends its own client identity and a stable session ID across replies, summaries, and titles. |
| DeepSeek | Save a direct DeepSeek API key. Flash supports screenshots; use the capability label for other models. |
| Ollama | Start your local server; the default endpoint is `http://localhost:11434/v1`. |
| LM Studio | Start its local API server; the default endpoint is `http://localhost:1234/v1`. |

For local models, an API key is not required by default. Screenshot support depends on the model you load. Additional OpenAI-compatible endpoints can be configured through provider metadata; see [Configuration](docs/CONFIGURATION.md).

Zen and Go use model metadata to determine API format and image support. Bundled catalogs provide a fallback, and a failed refresh retains the existing list. Live authenticated checks of the new Zen, Go, and DeepSeek integrations remain outstanding; automated adapter tests do not establish live service compatibility. See [provider research](docs/PROVIDER_RESEARCH.md) for the implementation sources and Go's documented usage expectations.

## Use Shade

Press `Ctrl+/` to show the overlay, type a question, and press Enter. To ask about your screen, attach a screenshot first or use `Ctrl+Enter` to send with a fresh capture. In automatic screenshot mode, Shade uses predictive capture when available and captures on send when needed.

| Shortcut | Action |
| --- | --- |
| `Ctrl+/` | Toggle overlay visibility |
| `Ctrl+R` | Start a new chat |
| `Enter` | Send a message |
| `Shift+Enter` | Insert a newline |
| `Ctrl+Enter` | Send with a fresh screenshot; empty input uses “Assist” |
| `Ctrl+'` | Toggle collapsed/expanded view |
| `Ctrl+Shift+S` | Capture a screenshot |
| `Ctrl+M` | Toggle the model switcher |

Most overlay shortcuts are active only while the overlay is visible. Use the Dashboard to manage sessions and settings. The send button becomes a stop button while a response is generating.

## Privacy and storage

- Settings and conversations are stored locally in Electron's user-data directory, under `data/`. On Windows this is typically `%APPDATA%/Shade/`.
- Messages, included conversation context, and attached screenshots are sent to the selected provider. Optional summaries and session titles also make model requests. The provider's own retention and usage policies apply.
- Screenshot history is optional and disabled by default. Saved screenshots live alongside session data; prior screenshots are not resent as conversation history.
- API keys use Electron's OS-backed `safeStorage` encryption when available. This branch can fall back to plaintext if encryption is unavailable or fails; local storage is not a guarantee of encryption.
- Shade has no cloud session sync or usage telemetry. Model refresh contacts provider catalogs and, for OpenCode metadata, `models.dev`. Enabled update checks contact the release service.
- On supported Windows systems, **Exclude overlay from screenshots** controls persistent capture protection. When disabled, Shade still attempts to hide its overlay during its own capture.

## Development

Use Windows and **Node.js 22.12 or newer** with npm. The Vite toolchain no longer supports Node.js 18.

```bash
git clone https://github.com/MichaelT025/Shade.git
cd Shade
npm ci
npm run dev
```

Development mode starts Vite and Electron together. To launch Electron without the development server, build the renderer first:

```bash
npx vite build
npm start
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite and Electron |
| `npm run test:run` | Run the test suite once |
| `npm test` | Run tests in watch mode |
| `npm run test:ui` | Open the Vitest UI |
| `npm run test:coverage` | Collect test coverage |
| `npm run build:win -- --publish never` | Build a Windows installer without publishing |

Windows build output is written to `dist/`, including `Shade-Setup-<version>.exe` and the unpacked app. Provider-only branch validation passed 342 tests (15 existing skips) and produced a Windows installer. Live API and interactive app tests are separate checks.

```text
src/main/       Electron lifecycle, windows, IPC, and updates
src/renderer/   Overlay, Dashboard, model switcher, and rendering
src/services/   Provider adapters, catalogs, configuration, and persistence
docs/           Configuration, modes, testing, and design notes
```

## Troubleshooting

**A provider or model is missing:** confirm you installed a build containing it, save the appropriate key, and refresh models. A model must have recognized protocol metadata to appear in the Zen/Go picker.

**A screenshot request is blocked:** choose a model marked **Screenshots supported**, or remove the image and switch to manual screenshot mode for text-only chat.

**Key validation fails:** confirm the key belongs to the selected provider and that its account has access to the chosen model. Go requires Go access; Zen credits and Go allowance are separate. The app reports authentication, quota, and rate-limit errors.

**Local models do not appear:** start the Ollama or LM Studio server before refreshing. Load an image-capable model if you want screen assistance.

**The overlay appears in captures:** check **Exclude overlay from screenshots** in Configuration and confirm you are running a supported Windows version. Verify the behavior with the capture application you use.

**`npm start` opens a blank window:** run `npx vite build` first, or use `npm run dev`.

## Documentation and contributing

- [Contributing](CONTRIBUTING.md)
- [Configuration and data layout](docs/CONFIGURATION.md)
- [Provider integration research](docs/PROVIDER_RESEARCH.md)
- [Built-in modes](docs/modes.md)
- [Test suite guide](docs/TESTS_SETUP.md)

Some older detailed guides still show historical model names; use the current in-app model list when configuring a provider.

## License and acknowledgments

Shade is MIT licensed. See [LICENSE](LICENSE).

Built with Electron, Vite, Sharp, marked, DOMPurify, highlight.js, and KaTeX, with provider SDKs and protocol adapters. Inspired by [Cluely](https://cluely.com/) and [Pluely](https://pluely.com/).
