# GhostPad

A Windows desktop application providing real-time AI assistance through a translucent overlay. Capture your screen and ask questions powered by Google's Gemini API.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Overview

GhostPad is a lightweight, privacy-focused desktop assistant that stays on top of your work. Capture screenshots, ask questions about what you see, and get AI-powered answers from your choice of LLM provider - all without leaving your workflow.

**Core Features:**
- 🪟 Always-on-top translucent overlay
- 📸 Instant screen capture (overlay automatically excluded)
- 🤖 **Multi-provider LLM support** - Gemini, OpenAI, and Anthropic fully integrated
- 💬 **Conversation memory** - AI remembers context from earlier in the chat
- 🔑 Bring your own API key - No subscriptions, pay only for what you use
- 🔒 Privacy-first: no data persistence
- ⌨️ Global keyboard shortcuts
- 🎯 Lightweight and fast

## Screenshots

> Coming soon

## Installation

### Prerequisites

- Windows 10 (version 2004 or later) or Windows 11
- Node.js 18+ and npm
- API key for your chosen LLM provider:
  - **Gemini**: [Get API key](https://makersuite.google.com/app/apikey) (free tier available)
  - **OpenAI**: [Get API key](https://platform.openai.com/api-keys) (pay-as-you-go)
  - **Anthropic**: [Get API key](https://console.anthropic.com/) (Claude Haiku 4.5 default)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/MichaelT025/Project-GhostPad.git
   cd Project-GhostPad
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the application**
   ```bash
   npm start
   ```

   **Important:** Run from Windows Command Prompt or PowerShell (not Cygwin/Git Bash due to Electron compatibility).

4. **Configure your LLM provider**
   - Click the settings icon in the overlay
   - Select your LLM provider (Gemini, OpenAI, etc.)
   - Enter your API key for the selected provider
   - Choose your preferred model
   - Click Save

## Usage

### Keyboard Shortcuts

- **Ctrl + /** - Toggle overlay visibility (show/hide)
- **Ctrl + R** - Start new chat (clears conversation and screenshot)

### Basic Workflow

1. **Capture a screenshot**
   - Click the screenshot button
   - The overlay will be automatically excluded from the capture
   - You'll see the button highlighted when a screenshot is attached

2. **Ask a question**
   - Type your question in the input field
   - Press Enter or click the send button
   - The AI will analyze both your question and the screenshot

3. **Get answers**
   - Responses stream in real-time
   - Continue the conversation with follow-up questions that reference earlier messages
   - The AI has full context of the current chat session
   - The screenshot remains attached until you start a new chat (Ctrl+R)

### Tips

- The overlay is draggable - click and drag the title bar to reposition
- The overlay is resizable - drag the edges to adjust size
- Screenshots are compressed automatically for faster API transmission
- Press Ctrl+R to clear everything and start fresh

## Technology Stack

- **Framework:** Electron v32.2.7
- **UI:** Vanilla JavaScript/HTML/CSS
- **Build Tool:** Vite
- **LLM Providers:** Multi-provider architecture
  - Google Gemini (`@google/generative-ai`) - Flash 2.0 default
  - OpenAI (`openai`) - GPT-4.1 with vision support
  - Anthropic Claude (`@anthropic-ai/sdk`) - Haiku 4.5 default
  - Custom/Local models (future)
- **Screen Capture:** Electron's `desktopCapturer` API
- **Image Processing:** Sharp (for compression)

## Development

### Project Structure

```
/src
  /main           - Electron main process
    main.js       - App entry, window management, IPC handlers
    preload.js    - Context bridge for secure IPC
  /renderer       - UI components
    index.html    - Overlay interface
  /services       - Core functionality
    screen-capture.js  - Screenshot capture & compression
    gemini-service.js  - Gemini API integration (planned)
  /utils          - Helper functions
/resources        - Assets and UI references
/testing          - Development screenshots (auto-saved in dev mode)
```

### Development Mode

Run the app in development mode:

```bash
npm start
```

In development mode (`NODE_ENV !== 'production'`):
- Screenshots are automatically saved to `testing/screenshots/` with timestamps
- DevTools are opened automatically for debugging
- All files in `testing/` are excluded from git

### Building for Production

```bash
npm run build      # Build for current platform
npm run build:win  # Build for Windows specifically
```

The built application will be in the `build/` directory.

## Architecture Highlights

### Screen Capture

GhostPad uses a sophisticated approach to exclude the overlay from screenshots:

- **Window Exclusion:** Uses `setContentProtection(true)` API (Windows 10 v2004+)
- **Instant Capture:** Electron's `desktopCapturer` captures screens without hiding the overlay
- **High-DPI Support:** Captures at 3840x2160 resolution for sharp screenshots
- **Smart Compression:** Resizes to max 1920px width, compresses to JPEG (quality 80-85)
- **Target Size:** Keeps images under 5MB for Gemini API compatibility

### Privacy & Security

- **No Persistence:** Screenshots are never saved to disk (except in dev mode for debugging)
- **Session-Only History:** Chat history exists only in memory during your chat session, sent to LLM for context, then cleared on new chat (Ctrl+R) or app restart
- **Local API Keys:** Your API keys are stored locally in a config file (never transmitted to us)
- **User-Controlled Capture:** Screenshots only happen when you click the button
- **Excluded from Git:** Config files with API keys are in `.gitignore`

## Current Status

**Completed:**
- ✅ Electron window with translucent overlay
- ✅ Draggable and resizable window
- ✅ Global hotkeys (Ctrl+/, Ctrl+R)
- ✅ Screen capture with overlay exclusion
- ✅ Image compression and optimization
- ✅ Development mode debugging features
- ✅ Multi-provider LLM architecture (Gemini, OpenAI, Anthropic)
- ✅ All three providers fully integrated with streaming support
- ✅ Settings panel with provider selection and API key management
- ✅ Streaming responses with progressive rendering
- ✅ Markdown rendering (GitHub-flavored)
- ✅ LaTeX math equation support (inline & block)
- ✅ Code syntax highlighting (10+ languages)
- ✅ Copy buttons for code blocks and messages
- ✅ Conversation memory (full context awareness across chat session)

**In Progress:**
- ⏳ **Additional Features & Polish**
  - ⏳ Max history limit for token usage optimization
  - ⏳ Multi-monitor support with display selection

**Planned:**
- ⬜ Multi-monitor support
- ⬜ Custom API endpoints
- ⬜ Local LLM support (Ollama, LM Studio)
- ⬜ Installer for Windows
- ⬜ Screenshot annotations

## Troubleshooting

### Overlay not excluded from screenshots

**Issue:** The overlay appears in screenshots.

**Solution:** You need Windows 10 version 2004 (May 2020 Update) or later for `setContentProtection()` to work. Update Windows if you're on an older version.

### "Cannot read properties of undefined" error

**Issue:** Error when starting the app from Cygwin or Git Bash.

**Solution:** Electron doesn't work correctly in Cygwin terminals. Use Windows Command Prompt or PowerShell instead:
```cmd
npm start
```

### Screenshots are too large

**Issue:** Screenshots exceed 5MB and take too long to upload.

**Solution:** The app automatically compresses images. If you're still experiencing issues, you may have an extremely high-resolution display. This is handled automatically in the compression logic.

### API key not saving

**Issue:** API key doesn't persist after restart.

**Solution:** Make sure the app has write permissions in its directory. The config file is stored in your user data directory.

## Getting API Keys

### Google Gemini (Recommended for Testing)
1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key and paste it into GhostPad's settings
5. **Free tier**: 60 requests per minute

### OpenAI
1. Visit [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create an account or sign in
3. Navigate to API Keys section
4. Click "Create new secret key"
5. **Default Model**: GPT-4.1 (latest with vision support)
6. **Pricing**: Pay-as-you-go

### Anthropic Claude
1. Visit [Anthropic Console](https://console.anthropic.com/)
2. Sign up for API access
3. Generate an API key
4. **Default Model**: Claude Haiku 4.5 (fastest and most affordable)
5. **Pricing**: Pay-as-you-go

**Security Note:** All API keys are stored locally on your machine and never transmitted to us or any third parties besides your chosen LLM provider.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Roadmap

### Phase 1 (Completed) ✅
- [x] Core Electron setup and overlay
- [x] Screen capture with compression
- [x] Multi-provider LLM architecture
- [x] Gemini provider implementation with streaming backend
- [x] Basic chat UI (vanilla JS)

### Phase 2 (Completed) ✅
- [x] Streaming response backend (Gemini)
- [x] **Streaming frontend integration** (IPC + progressive rendering)
- [x] **Markdown rendering** (marked.js - GitHub-flavored)
- [x] **LaTeX math rendering** (KaTeX - inline & block equations)
- [x] **Code syntax highlighting** (highlight.js - 10+ languages)
- [x] **Interactive elements** (copy buttons, message actions)
- [x] **Enhanced error handling** (categorization, retry logic)
- [x] Multi-provider settings panel UI
- [x] **Custom icon system** (SVG icons for all UI elements)
- [x] **Modern UI design** (glassmorphic overlay, refined message bubbles)
- [x] **Silent screenshot mode** (icon-only feedback, no popups/previews)

### Phase 3 (Completed) ✅
- [x] OpenAI provider adapter (GPT-4 Vision)
- [x] Anthropic Claude provider adapter (Claude 3 Opus/Sonnet/Haiku)
- [x] Provider switching in UI
- [x] Advanced error handling per provider

### Phase 4 (Next)
- [ ] Multi-monitor support with display selection
- [ ] Custom system prompts per provider
- [ ] Screenshot annotations
- [ ] Conversation export
- [ ] Max history limit for token usage optimization

### Phase 5 (Future)
- [ ] Custom API endpoint support
- [ ] Local LLM support (Ollama, LM Studio)
- [ ] Auto-update functionality
- [ ] macOS and Linux support (if demand exists)

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- LLM Providers:
  - [Google Gemini](https://deepmind.google/technologies/gemini/)
  - [OpenAI](https://openai.com/)
  - [Anthropic Claude](https://www.anthropic.com/)
- Image processing by [Sharp](https://sharp.pixelplumbing.com/)

## Support

If you encounter any issues or have questions:
- Open an issue on GitHub
- Check the [Troubleshooting](#troubleshooting) section above
- Review the project documentation in `CLAUDE.md` and `plan.md`

---

**Made with ☕ for Windows users who want AI assistance without the bloat.**
