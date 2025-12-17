# Product Requirements Document (PRD)
# Shade

**Version:** 1.0
**Last Updated:** December 16, 2024
**Author:** Product Team
**Status:** Draft for V1 Release

---

## Executive Summary

**Shade** is a Windows desktop application that provides a translucent, always-on-top AI overlay for screen-based assistance. Users capture screenshots and ask questions about their screen content using their own API keys from major LLM providers.

**Tagline:** *"The Invisible AI Assistant"*

**Core Value Proposition:**
- **Privacy-first** - All data stays local on the user's machine
- **BYOK (Bring Your Own Key)** - No subscriptions, users pay only for their API usage
- **Free & Open-source** - No cost, community-driven development
- **Lightweight & Unobtrusive** - Minimal, always-accessible overlay

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [Target Audience](#2-target-audience)
3. [Use Cases](#3-use-cases)
4. [Competitive Analysis](#4-competitive-analysis)
5. [V1 Requirements](#5-v1-requirements)
6. [Feature Specifications](#6-feature-specifications)
7. [Technical Architecture](#7-technical-architecture)
8. [User Experience](#8-user-experience)
9. [Success Metrics](#9-success-metrics)
10. [Roadmap](#10-roadmap)
11. [Non-Goals & Constraints](#11-non-goals--constraints)
12. [Open Questions](#12-open-questions)

---

## 1. Product Vision

### 1.1 Problem Statement

Users need quick, contextual AI assistance while working on their computers. Current solutions either:
- Require switching context to a browser/app (ChatGPT, Claude.ai)
- Are expensive subscriptions (Cluely, paid AI assistants)
- Send data through third-party servers (privacy concerns)
- Can't see what the user is looking at (text-only assistants)

### 1.2 Solution

Shade is an invisible assistant that:
- Floats above all windows, always accessible
- Sees exactly what you see via screenshot capture
- Uses your own API keys (privacy + cost control)
- Stays out of screen recordings (content protection)
- Remembers your conversation context within sessions

### 1.3 Vision Statement

> "To be the most private, accessible, and unobtrusive AI assistant for visual screen assistance."

### 1.4 Product Principles

1. **Privacy by Default** - No data leaves the user's machine except to their chosen LLM provider
2. **User Control** - Users choose when to capture, which provider to use, and what to share
3. **Minimal Footprint** - Small, fast, stays out of the way until needed
4. **Open & Transparent** - Open-source, no hidden data collection, community-driven
5. **Provider Agnostic** - Works with any major LLM provider or local models

---

## 2. Target Audience

### 2.1 Primary: Students

**Demographics:**
- High school, university, and graduate students
- Ages 16-30
- Tech-comfortable but not necessarily developers
- Cost-conscious (prefer free/BYOK over subscriptions)

**Needs:**
- Help understanding lecture notes and textbooks
- Step-by-step problem solving (math, science, coding)
- Quick explanations of concepts on screen
- Study assistance without expensive tools

**Pain Points:**
- Can't afford AI subscriptions
- Privacy concerns with school/proctoring software
- Need visual context (diagrams, equations, code)
- Switching between AI chat and study materials is disruptive

### 2.2 Secondary: Developers

**Demographics:**
- Software developers, CS students
- Ages 18-45
- Highly technical, power users
- Value efficiency and keyboard shortcuts

**Needs:**
- Debugging assistance with error messages on screen
- LeetCode/algorithm problem explanations
- Code review and explanations
- Quick documentation lookups

**Pain Points:**
- Context switching between IDE and AI chat
- Copy-pasting code/errors is tedious
- Need to see the code while getting explanations

### 2.3 Tertiary: General Users

**Demographics:**
- Knowledge workers, professionals
- Ages 25-55
- Moderate technical comfort
- Value productivity tools

**Needs:**
- "What does this mean?" for anything on screen
- Help with forms, documents, unfamiliar interfaces
- Quick answers without searching
- Translation and explanation of technical content

---

## 3. Use Cases

### 3.1 Primary Use Cases

#### UC-1: Lecture Note Explanation
**Actor:** Student
**Scenario:** Professor's slides are on screen with complex concepts
**Flow:**
1. Student opens GhostPad (collapsed state)
2. Types "Explain these notes to me" and presses Enter
3. GhostPad captures screenshot, sends to LLM
4. Overlay expands, shows streaming explanation
5. Student asks follow-up: "What does [specific term] mean?"
6. AI responds with context from the screenshot

#### UC-2: LeetCode Problem Solving
**Actor:** Developer/Student
**Scenario:** LeetCode problem displayed in browser
**Flow:**
1. Developer sees difficult problem
2. Opens GhostPad, types "Show me step by step how to solve this"
3. AI analyzes problem from screenshot
4. Provides conceptual approach, then pseudocode, then solution
5. Developer asks clarifying questions as needed

#### UC-3: Error Message Debugging
**Actor:** Developer
**Scenario:** IDE showing error message and stack trace
**Flow:**
1. Developer encounters cryptic error
2. Opens GhostPad, types "What's causing this error?"
3. AI reads error message and surrounding code context
4. Provides explanation and suggested fix
5. Developer implements fix, asks follow-up if needed

#### UC-4: Quick Definition/Explanation
**Actor:** Any user
**Scenario:** Unfamiliar term, chart, or interface on screen
**Flow:**
1. User sees something confusing
2. Opens GhostPad, types "What is [thing] on my screen?"
3. AI identifies and explains the element
4. User continues their work

### 3.2 Secondary Use Cases

- **Document Analysis:** "Summarize this PDF page"
- **Form Filling Help:** "What should I put in this field?"
- **Translation:** "Translate this text on screen"
- **Math Problem Solving:** "Solve this equation step by step"
- **Code Explanation:** "What does this function do?"

---

## 4. Competitive Analysis

### 4.1 Direct Competitors

| Feature | Shade | Cluely | ChatGPT Desktop | Copilot |
|---------|-------|--------|-----------------|---------|
| **Price** | Free (BYOK) | $60/month | $20/month | Free/$20 |
| **Screen Capture** | Yes | Yes | No | Limited |
| **Always-on-top** | Yes | Yes | No | No |
| **Privacy** | Local only | Their servers | Their servers | Their servers |
| **Open Source** | Yes | No | No | No |
| **Multi-provider** | Yes | No | OpenAI only | Microsoft only |
| **Local Models** | Yes (planned) | No | No | No |
| **Overlay Exclusion** | Yes | Yes | N/A | N/A |

### 4.2 Competitive Advantages

1. **Free & BYOK** - No subscription, pay only for API usage
2. **Privacy-first** - Data never touches third-party servers (except LLM API)
3. **Open-source** - Transparent, community-driven, forkable
4. **Multi-provider** - Not locked into one AI provider
5. **Local model support** - Can run completely offline
6. **Lightweight** - Minimal resource usage, fast startup

### 4.3 Competitive Disadvantages

1. **Requires API key setup** - Higher friction than subscription services
2. **Windows-only (V1)** - Limited platform support initially
3. **No mobile** - Desktop only
4. **Self-service** - No customer support (community only)

---

## 5. V1 Requirements

### 5.1 Must Have (P0)

| ID | Requirement | Description |
|----|-------------|-------------|
| P0-1 | **Collapsible Overlay** | Default collapsed state (input bar only), expands on first message, manual toggle via shortcut |
| P0-2 | **Homepage with Sessions** | Session history (last 30 days), searchable by title, deletable, resumable |
| P0-3 | **Provider Registry** | Unified config system for all providers (LLredo.md architecture) |
| P0-4 | **Local Model Support** | OpenAI-compatible custom endpoint for Ollama, LM Studio, etc. |
| P0-5 | **Fixed Memory Limit** | Predefined message limit per session, prompt to start new chat when near limit |
| P0-6 | **Manual Screenshot** | "Use Screen" button captures current screen |
| P0-7 | **Multi-provider Support** | Gemini, OpenAI, Anthropic fully functional |
| P0-8 | **Streaming Responses** | Real-time response rendering with markdown/LaTeX/code |
| P0-9 | **Overlay Exclusion** | Window hidden from screen recordings via `setContentProtection` |
| P0-10 | **Settings Window** | API keys, provider selection, model selection per provider |

### 5.2 Should Have (P1)

| ID | Requirement | Description |
|----|-------------|-------------|
| P1-1 | **Automatic Screenshot Mode** | Toggle to capture fresh screenshot with every message |
| P1-2 | **Session Search** | Search sessions by title on homepage |
| P1-3 | **Model Switcher** | Quick model switching via shortcut popup or `/models` command |
| P1-4 | **Keyboard Shortcuts** | Customizable shortcuts for common actions |
| P1-5 | **Cost Information** | Display API cost implications in settings |

### 5.3 Nice to Have (P2)

| ID | Requirement | Description |
|----|-------------|-------------|
| P2-1 | **Export Session** | Export conversation as markdown |
| P2-2 | **Quick Model Switcher** | Model selection accessible from collapsed mode |
| P2-3 | **Session Titles** | Auto-generate or manual session titles |
| P2-4 | **Onboarding Flow** | First-time setup wizard for API keys |

### 5.4 Out of Scope for V1

- File attachments (PDFs, documents)
- Video/audio input
- Agentic actions (MCP)
- Cross-platform (macOS, Linux)
- Cloud sync
- Mobile apps
- Usage/cost tracking dashboard
- Themes beyond dark mode

---

## 6. Feature Specifications

### 6.1 Collapsible Overlay

**Description:** The main overlay window has two states - collapsed (minimal) and expanded (full chat).

**Collapsed State:**
- Shows only: Settings button, input field, send button
- Dimensions: ~500px wide, ~60px tall
- User can type and send messages
- Default state on app startup

**Expanded State:**
- Shows: Title bar, chat messages, input field
- Dimensions: User-resizable (min 400x300, max screen size)
- Displays conversation history
- Triggered when first message is sent

**State Transitions:**
- Collapsed → Expanded: First message sent in session
- Expanded → Collapsed: Manual toggle (keyboard shortcut TBD)
- On new session start: Returns to collapsed

**Keyboard Shortcuts:**
- `Ctrl+/`: Toggle overlay visibility (show/hide)
- `Ctrl+R`: New chat (clear session)
- `Ctrl+[TBD]`: Toggle collapsed/expanded
- `Ctrl+[TBD]`: Open model switcher

### 6.2 Homepage with Sessions

**Description:** A home screen showing previous chat sessions with settings access.

**Session List:**
- Displays sessions from last 30 days
- Each session shows: Title, date, preview of first message
- Sorted by most recent first
- Search bar to filter by title

**Session Actions:**
- Click to resume session
- Delete individual sessions
- Clear all sessions

**Settings Access:**
- Settings button/link on homepage
- Full settings in separate window/panel

**Storage:**
- Local storage (JSON files or SQLite in userData directory)
- Auto-cleanup of sessions older than 30 days
- Session data: messages, timestamps, provider used, screenshots (compressed)

### 6.3 Provider Registry System

**Description:** Unified configuration system for all LLM providers (per LLredo.md).

**Architecture:**
```
provider-registry.js (central metadata)
    ↓
config-service.js (unified providers object)
    ↓
llm-factory.js (creates provider instances)
    ↓
providers/*.js (provider implementations)
```

**Config Structure:**
```json
{
  "activeProvider": "gemini",
  "providers": {
    "gemini": {
      "apiKey": "",
      "model": "gemini-2.5-flash",
      "enabled": true
    },
    "openai": {
      "apiKey": "",
      "model": "gpt-4.1",
      "enabled": true
    },
    "anthropic": {
      "apiKey": "",
      "model": "claude-sonnet-4-5",
      "enabled": true
    },
    "custom": {
      "apiKey": "",
      "model": "",
      "baseUrl": "",
      "enabled": true
    }
  }
}
```

**Adding New Providers:**
1. Create provider class implementing LLMProvider interface
2. Add entry to provider-registry.js
3. Done (UI auto-generates from registry)

### 6.4 Local Model Support

**Description:** Support for local LLMs via OpenAI-compatible API endpoints.

**Implementation:**
- New "Custom/Local" provider in registry
- User configures:
  - Base URL (e.g., `http://localhost:11434/v1` for Ollama)
  - Model name (user-entered)
  - Optional API key

**Supported Backends:**
- Ollama (with OpenAI compatibility layer)
- LM Studio (built-in OpenAI-compatible server)
- LocalAI
- Any OpenAI-compatible endpoint

**Limitations:**
- Vision support depends on local model capabilities
- No model list auto-detection (user must know model name)

### 6.5 Screenshot Modes

**Manual Mode (Default):**
- User clicks "Use Screen" button to capture
- Screenshot persists until new chat or manual re-capture
- Visual indicator when screenshot is attached

**Automatic Mode (P1):**
- Toggle in settings or via command
- Every message automatically captures fresh screenshot
- Higher API costs (clearly communicated to user)
- Ideal for tutoring scenarios where screen changes frequently

### 6.6 Model Switcher

**Description:** Quick way to change models without going to settings.

**Implementation Options:**
1. **Keyboard Shortcut:** `Ctrl+M` opens popup with model list
2. **Slash Command:** `/models` in input field opens selector
3. **Title Bar:** Click on model name in status pill to open selector

**Selector UI:**
- Groups models by provider
- Shows current selection
- Quick filter/search
- Recently used models at top

### 6.7 Memory Management

**Description:** Simplified conversation memory with fixed limits.

**Approach:**
- Fixed limit of N messages per session (e.g., 20-30 messages)
- No user-configurable limits (removed complexity)
- When approaching limit, show notification: "This session is getting long. Consider starting a new chat for better responses."
- Full history saved locally, but only recent N sent to LLM

**Rationale:**
- Simpler UX than configurable limits
- Prevents runaway token costs
- Encourages focused conversations

---

## 7. Technical Architecture

### 7.1 Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | Electron v32.2.7 |
| UI | Vanilla JavaScript/HTML/CSS |
| Build Tool | Vite |
| Screen Capture | Electron desktopCapturer API |
| Image Processing | Sharp |
| Storage | JSON files in userData directory |
| LLM Providers | @google/generative-ai, openai, @anthropic-ai/sdk |

### 7.2 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Renderer Process                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │Homepage │  │ Overlay │  │Settings │  │  Utils  │    │
│  │  (new)  │  │  (chat) │  │ Window  │  │(toasts) │    │
│  └────┬────┘  └────┬────┘  └────┬────┘  └─────────┘    │
│       │            │            │                       │
│       └────────────┴────────────┘                       │
│                    │                                    │
│              IPC Bridge (preload.js)                    │
└────────────────────┼────────────────────────────────────┘
                     │
┌────────────────────┼────────────────────────────────────┐
│                Main Process                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Window    │  │   Screen    │  │    Provider     │  │
│  │  Manager    │  │   Capture   │  │    Registry     │  │
│  └─────────────┘  └─────────────┘  └────────┬────────┘  │
│                                             │           │
│  ┌─────────────┐  ┌─────────────┐  ┌────────┴────────┐  │
│  │   Config    │  │   Session   │  │   LLM Factory   │  │
│  │   Service   │  │   Storage   │  │                 │  │
│  └─────────────┘  └─────────────┘  └────────┬────────┘  │
│                                             │           │
│                              ┌──────────────┼──────────┐│
│                              │   Providers  │          ││
│                              │ ┌─────┐┌─────┐┌──────┐  ││
│                              │ │Gemini││OpenAI││Custom│ ││
│                              │ └─────┘└─────┘└──────┘  ││
│                              └─────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 7.3 Data Flow

**Message Send Flow:**
```
User types message → Click Send / Press Enter
         ↓
[If auto-screenshot enabled] Capture screen
         ↓
Renderer sends via IPC: { text, screenshot, history }
         ↓
Main process: Get active provider from registry
         ↓
Provider.streamResponse(text, screenshot, history, onChunk)
         ↓
Chunks sent via IPC to renderer
         ↓
Renderer updates UI progressively
         ↓
Session saved to local storage
```

### 7.4 File Structure (V1)

```
/src
  /main
    main.js              # Main process entry
    preload.js           # IPC bridge
    window-manager.js    # Window state management
  /renderer
    /pages
      homepage.html      # NEW: Session list + settings access
      homepage.js
      overlay.html       # Renamed from index.html
      overlay.js         # Renamed from app.js
      settings.html
      settings.js
    /components          # Shared UI components
    /styles
      tokens.css
      homepage.css       # NEW
      overlay.css
      settings.css
    /assets/icons
    /utils
  /services
    config-service.js
    session-storage.js   # NEW: Session persistence
    provider-registry.js # NEW: Central provider metadata
    llm-factory.js
    llm-service.js
    screen-capture.js
    /providers
      gemini-provider.js
      openai-provider.js
      anthropic-provider.js
      custom-provider.js # NEW: OpenAI-compatible endpoint
```

### 7.5 Session Storage Schema

```javascript
// Session object
{
  id: "uuid-v4",
  title: "Explaining Neural Networks",  // Auto-generated or user-set
  createdAt: "2024-12-16T10:30:00Z",
  updatedAt: "2024-12-16T11:45:00Z",
  provider: "gemini",
  model: "gemini-2.5-flash",
  messages: [
    {
      id: "msg-uuid",
      type: "user",
      text: "Explain these notes to me",
      hasScreenshot: true,
      timestamp: "2024-12-16T10:30:00Z"
    },
    {
      id: "msg-uuid",
      type: "ai",
      text: "Based on the notes shown...",
      timestamp: "2024-12-16T10:30:15Z"
    }
  ],
  screenshots: {
    "msg-uuid": "base64-compressed-image"  // Stored separately for efficiency
  }
}
```

---

## 8. User Experience

### 8.1 User Flows

#### First-Time Setup
```
1. User installs and opens Shade
2. Homepage appears with empty session list
3. Prompt: "Get started by adding an API key"
4. Settings opens, user adds API key for preferred provider
5. User returns to homepage, starts first chat
6. Collapsed overlay appears
7. User types question, overlay expands with response
```

#### Returning User - New Session
```
1. User opens Shade
2. Homepage shows previous sessions
3. User clicks "New Chat" or presses shortcut
4. Collapsed overlay appears
5. User types question, session begins
```

#### Returning User - Resume Session
```
1. User opens Shade
2. Homepage shows previous sessions
3. User clicks on a previous session
4. Overlay opens in expanded state with history loaded
5. User continues conversation
```

### 8.2 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+/` | Toggle overlay visibility |
| `Ctrl+R` | New chat (clear current session) |
| `Ctrl+E` | Toggle collapsed/expanded (TBD) |
| `Ctrl+M` | Open model switcher (TBD) |
| `Ctrl+,` | Open settings (TBD) |
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Escape` | Close overlay / cancel |

### 8.3 UI States

**Overlay States:**
1. Hidden (not visible)
2. Collapsed (input bar only)
3. Expanded (full chat view)
4. Loading (streaming response)
5. Error (API error, network error)

**Homepage States:**
1. Empty (no sessions)
2. Populated (sessions list)
3. Search results
4. Loading (fetching sessions)

### 8.4 Error Handling

| Error Type | User Message | Action |
|------------|--------------|--------|
| No API Key | "Add an API key to get started" | Link to settings |
| Invalid API Key | "API key is invalid. Check your settings." | Link to settings |
| Rate Limited | "Too many requests. Try again in X seconds." | Auto-retry timer |
| Network Error | "Can't connect. Check your internet." | Retry button |
| Server Error | "Something went wrong. Try again." | Retry button + details |

---

## 9. Success Metrics

### 9.1 Primary Metrics (GitHub)

| Metric | V1 Target (3 months) | V1.x Target (6 months) |
|--------|----------------------|------------------------|
| GitHub Stars | 500 | 2,000 |
| Forks | 50 | 200 |
| Downloads (releases) | 1,000 | 5,000 |
| Contributors | 5 | 15 |

### 9.2 Engagement Metrics (If Tracking Implemented)

| Metric | Target |
|--------|--------|
| Daily Active Users | N/A (no tracking) |
| Sessions per User | N/A (no tracking) |
| Messages per Session | N/A (no tracking) |

*Note: Privacy-first means we don't track usage. Metrics come from GitHub and community feedback.*

### 9.3 Quality Metrics

| Metric | Target |
|--------|--------|
| GitHub Issues (open bugs) | < 20 |
| Issue Response Time | < 48 hours |
| Release Cadence | Monthly |
| Test Coverage | > 60% |

---

## 10. Roadmap

### 10.1 V1.0 - MVP Release

**Timeline:** Q1 2025
**Theme:** Core Functionality + Session Management

**Features:**
- [x] Multi-provider LLM support (Gemini, OpenAI, Anthropic)
- [x] Screen capture with overlay exclusion
- [x] Streaming responses with markdown/LaTeX/code
- [x] Settings window with API key management
- [ ] Collapsible overlay (default collapsed)
- [ ] Homepage with session history
- [ ] Provider registry refactor
- [ ] Local model support (OpenAI-compatible)
- [ ] Fixed memory limits
- [ ] Model switcher (shortcut + command)

### 10.2 V1.x - Polish & Expansion

**Timeline:** Q2 2025
**Theme:** UX Improvements + More Providers

**Features:**
- [ ] Automatic screenshot mode
- [ ] Session search and filtering
- [ ] Additional providers (Groq, Mistral, Cohere)
- [ ] Usage/cost tracking dashboard
- [ ] Export sessions as markdown
- [ ] Keyboard shortcut customization
- [ ] Improved onboarding flow

### 10.3 V2.0 - File Support & Automation

**Timeline:** Q3-Q4 2025
**Theme:** Beyond Screenshots

**Features:**
- [ ] File attachments (PDF, images, documents)
- [ ] Drag-and-drop files to chat
- [ ] OCR for image text extraction
- [ ] Token/cost estimation before send
- [ ] Auto-summarization for long sessions

### 10.4 V3.0 - Agentic & Integrations

**Timeline:** 2026
**Theme:** Personal Assistant Evolution

**Features:**
- [ ] MCP (Model Context Protocol) support
- [ ] Agentic actions (open apps, click, type)
- [ ] Calendar integration
- [ ] Email integration
- [ ] Video/audio input
- [ ] Cross-platform (macOS, Linux)

---

## 11. Non-Goals & Constraints

### 11.1 Non-Goals for V1

1. **Not a general-purpose AI chat app** - Focus is on screen context, not general Q&A
2. **Not a code editor** - Complements IDE, doesn't replace it
3. **Not a note-taking app** - Sessions are temporary (30 days), not permanent notes
4. **Not a proctoring bypass tool** - Privacy features are for legitimate use cases
5. **Not cross-platform (yet)** - Windows-only for V1
6. **Not a subscription service** - No paid tiers, BYOK only

### 11.2 Constraints

**Technical:**
- Windows 10 v2004+ required (for setContentProtection)
- Electron framework (larger bundle size)
- Requires Node.js for development

**Business:**
- No revenue model initially (open-source)
- No customer support (community-driven)
- No telemetry/analytics (privacy-first)

**Legal/Ethical:**
- Must not facilitate academic dishonesty marketing
- Must not market as proctoring evasion tool
- Must comply with LLM provider ToS

### 11.3 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| LLM API pricing increases | Medium | High | Support multiple providers + local models |
| Competition from OS-native AI | High | Medium | Focus on privacy + open-source advantages |
| Academic integrity backlash | Medium | High | Market as learning tool, not cheating tool |
| Low adoption | Medium | Medium | Community building, developer marketing |

---

## 12. Resolved Questions

### 12.1 Decided

| Question | Decision | Date |
|----------|----------|------|
| Branding Timeline | Rebrand now (GhostPad → Shade) | 2024-12-16 |
| Freemium Model | Discuss after V1 release | 2024-12-16 |
| Session Title Generation | AI-generated | 2024-12-16 |
| Collapse Shortcut | `Ctrl+'` | 2024-12-16 |
| Memory Limit Number | 30 messages | 2024-12-16 |
| Cloud Sync | Discuss after V1 | 2024-12-16 |
| Mobile Apps | Not in foreseeable future | 2024-12-16 |
| macOS/Linux | Target both by V1.1 (macOS priority) | 2024-12-16 |
| Monetization | Discuss after V1 | 2024-12-16 |

---

## Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| BYOK | Bring Your Own Key - users provide their own API keys |
| LLM | Large Language Model (GPT, Claude, Gemini, etc.) |
| MCP | Model Context Protocol - Anthropic's standard for AI tool use |
| Provider | An LLM service (OpenAI, Anthropic, Google, local) |
| Session | A single conversation thread with history |
| Overlay | The always-on-top Shade window |

### B. References

- [CLAUDE.md](/CLAUDE.md) - Technical implementation details
- [LLredo.md](/docs/plans/LLredo.md) - Provider registry refactor plan
- [memoryplan.md](/docs/plans/memoryplan.md) - Memory management plan
- [context.md](/docs/agents/context.md) - Product context and decisions

### C. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-12-16 | Initial PRD creation |

---

*This PRD is a living document. Updates will be tracked in the Change Log.*
