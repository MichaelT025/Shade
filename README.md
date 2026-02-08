# Shade

**Your screen, smarter**

A Windows desktop application providing real-time AI assistance through a translucent, always-on-top overlay. Capture your screen and ask questions - powered by your choice of LLM provider.

![Version](https://img.shields.io/badge/version-0.11.4-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)
![License](https://img.shields.io/badge/license-MIT-green)

> Note: Windows is the primary supported platform today. Shade has some macOS compatibility work (icons + shortcut conflicts), but packaged macOS releases are not yet an official target.

## Why Shade?

- **Privacy-First** - All data stays on your machine. No telemetry, no cloud sync, no tracking.
- **BYOK (Bring Your Own Key)** - No subscriptions. Use your own API keys and pay only for what you use.
- **Free & Open Source** - MIT licensed, community-driven development.
- **Lightweight** - Minimal, fast, stays out of your way until you need it.
- **Provider Agnostic** - Works with Gemini, OpenAI, Anthropic, Grok, OpenRouter or your own local models.

## Features

- **Always-on-top translucent overlay** - Floats above all windows, always accessible
- **Collapsible interface** - Minimal input bar by default, expands when you need it
- **Screen capture** - Overlay automatically excluded from screenshots
- **Automatic screenshot mode** - Predictive capture for zero-latency AI assistance
- **Polished UI/UX** - Fluid animations and intelligent screenshot preview positioning
- **Multi-provider support** - Gemini, OpenAI, Anthropic, plus OpenAI-compatible endpoints (Ollama / LM Studio)
- **Rich responses** - Markdown, LaTeX math, and professional syntax highlighting with custom themes
- **Session history dashboard** - Browse, search, rename, save, and resume conversations (stored locally)
- **System prompt modes** - Built-in modes and editable prompts (per-mode)
- **In-app configuration** - Provider, API key validation, model selection + refresh, and screenshot/memory toggles
- **Model switcher** - Dedicated model picker window (`Ctrl+M`) with provider switching and toggle support
- **Keyboard shortcuts** - Toggle visibility, start new chat, collapse/expand, capture screenshot

## Installation

### Prerequisites

- Windows 10 (version 2004+) or Windows 11
- Node.js 18+ and npm
- API key from your preferred provider:
  - **Gemini**: [Get API key](https://makersuite.google.com/app/apikey) (free tier available)
  - **OpenAI**: [Get API key](https://platform.openai.com/api-keys)
  - **Anthropic**: [Get API key](https://console.anthropic.com/)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/MichaelT025/Shade.git
cd Shade

# Install dependencies
npm install

# Start in dev mode (Vite + Electron)
npm run dev

# Or launch Electron directly (requires built renderer assets)
# npm start
```



### First-Time Setup

1. Open Shade — you’ll see a minimal input bar
2. Open the Dashboard and go to **Configuration**
3. Choose your provider and paste your API key (it auto-tests/validates)
4. Select your default model (or refresh the model list)
5. Optional: open **Modes** to choose/customize a system prompt
6. Start chatting!

## Usage

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+/` | Toggle overlay visibility (minimize/restore) |
| `Ctrl+R` | Start new chat |
| `Enter` | Send message (Shift+Enter for newline) |
| `Ctrl+Enter` | Quick send with fresh screenshot ("Assist") |
| `Ctrl+'` | Toggle collapsed/expanded |
| `Ctrl+Shift+S` | Capture screenshot |
| `Ctrl+M` | Toggle model switcher (macOS: `Cmd+Shift+M`) |

### Basic Workflow

1. **See something on screen you have a question about?**
2. **Press `Ctrl+/`** to show Shade
3. **Click the Image button** to capture a screenshot (or enable auto-capture in settings)
4. **Type your question** and press Enter
5. **Get AI-powered answers** with full context of what's on your screen

### Tips

- Drag the title bar to reposition
- Resize by dragging edges (Both states are resizable)
- Screenshots persist until you start a new chat
- Use the Dashboard to manage sessions and configuration

## Technology

- **Framework:** Electron
- **Bundler:** Vite
- **UI:** JavaScript/HTML/CSS (renderer)
- **LLM Providers:** Gemini, OpenAI, Anthropic, OpenAI-compatible endpoints
- **Screen Capture:** Electron's `desktopCapturer` with `setContentProtection`
- **Rendering:** marked.js (Markdown), KaTeX (LaTeX), highlight.js (code)

## Privacy & Security

Shade is designed with privacy as a core principle:

- **Local Storage Only** - Config and sessions stored in your user data directory
- **Encrypted API keys** - Stored using OS-level encryption via Electron `safeStorage` when available
- **No Cloud Sync** - Nothing leaves your machine except API calls to your chosen provider
- **No Telemetry** - We don't track usage, collect analytics, or phone home
- **You Control the Data** - Sessions (and any attached screenshots) are stored locally in your user data folder, and can be deleted any time (including a full wipe from the Dashboard)
- **Open Source** - Audit the code yourself

## Development

### Project Structure

```
/src
  /main           - Electron main process
    /ipc          - Domain-specific IPC handlers
    /services     - Main-process services (e.g., updates)
    /windows      - Window management and creation
  /renderer       - UI (HTML, JS, CSS)
    /homepage     - Dashboard logic (controllers, services)
    /utils        - Shared renderer utilities (rendering, session)
  /services       - Core business logic (LLM providers, config, persistence)
/docs             - Documentation and plans
```

### Commands

```bash
npm run dev       # Run in development mode (Vite + Electron)
npm start         # Run Electron (built assets)
npm test          # Run unit tests
npm run build:win # Build Windows executable
```

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, testing/build commands, and pull request guidelines.

### Docs

- Provider/model config details: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
- Default shipped modes/prompts: [docs/modes.md](docs/modes.md)
- Test suite walkthrough: [docs/TESTS_SETUP.md](docs/TESTS_SETUP.md)

## Roadmap

### V1.0 (Current)
- [x] Multi-provider LLM support (Cloud & Local)
- [x] Screen capture with overlay exclusion
- [x] Rich text rendering (Markdown, LaTeX, code)
- [x] Collapsible overlay with state synchronization
- [x] Session history dashboard (search, rename, bulk actions)
- [x] OpenAI-compatible local endpoints (Ollama / LM Studio)
- [x] Automatic screenshot mode (with predictive caching)
- [x] Predictive screenshot caching for zero-latency auto-capture
- [x] Model selection & quick-switcher (`Ctrl+M`, macOS: `Cmd+Shift+M`)
- [x] System prompt modes (built-in + editable)
- [x] Smart memory management with summarization
- [x] Unit test suite (Vitest)
- [x] Encrypted local storage for API keys
- [x] Security hardening (XSS protection & atomic writes)

### V1.1
- [ ] macOS support
- [ ] Linux support
- [ ] Usage/cost tracking
- [ ] File attachments
### V2.0+
- [ ] Agentic actions (MCP)
- [ ] Calendar/email integration

See [PRD.md](docs/PRD.md) for the complete product roadmap.

## Troubleshooting

### Overlay appears in screenshots
You need Windows 10 version 2004 (May 2020) or later. Update Windows if on an older version.


### API key not saving
Check write permissions in your user data directory.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- LLM Providers: [Google Gemini](https://deepmind.google/technologies/gemini/), [OpenAI](https://openai.com/), [Anthropic](https://www.anthropic.com/)
- Image processing: [Sharp](https://sharp.pixelplumbing.com/)

### Inspiration

- [Cluely](https://cluely.com/)
- [Pluely](https://pluely.com/)

---

**Made for Windows users who want AI assistance without the bloat.**
