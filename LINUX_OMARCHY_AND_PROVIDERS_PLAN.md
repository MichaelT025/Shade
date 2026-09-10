# Linux/Omarchy Port and Provider Expansion Plan

## Implementation review — 2026-09-10

Linux work is on `codex/linux-omarchy-support`; provider phases remain deferred.
The original architecture is sound, with these corrections before implementation:

- Portal capture must keep a consented stream alive between screenshots. Repeated
  `desktopCapturer.getSources()` calls are not a reusable screenshot session.
  Predictive capture must never open a permission picker; first consent is manual.
- Wayland placement, focus, resizing, and always-on-top are compositor-controlled.
  Windows overlay behavior cannot be an unconditional Linux acceptance promise.
- Electron content protection is unavailable on Linux. Disable the setting and
  explain that Shade may appear in both its own screenshots and other screen shares.
- Keep Wayland shortcut registrations stable for the process lifetime and gate
  overlay actions by visibility. A successful registration is not evidence that a
  Hyprland binding actually fires; compositor/portal verification remains required.
- Match the installed desktop filename to Electron's portal identity. AppImage
  launch alone does not guarantee desktop-file installation or menu integration.
- Treat `safeStorage`'s Linux `basic_text` backend as insecure even if encryption
  availability reports true. Preserve unreadable encrypted values; never pass
  ciphertext off as an API key or overwrite it on a failed save.
- Build with native dependencies installed on Linux. A Windows `node_modules`
  directory is not a valid source for Linux `sharp` binaries.
- Baseline automated tests: **18 files passed, 294 tests passed, 15 skipped**.
  The Windows installer build completed on this host. Interactive Windows and
  native Omarchy smoke tests are separate outstanding gates, not inferred from CI.
  See [Linux implementation and validation](docs/LINUX.md) for ongoing evidence.
- Keep staged commits by concern. Local implementation can proceed while hardware
  validation is pending; do not label the Linux port complete or publish it yet.

References checked for this review: [Electron shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut),
[Electron windows](https://www.electronjs.org/docs/latest/api/browser-window), and
[Hyprland desktop portal](https://wiki.hypr.land/Hypr-Ecosystem/xdg-desktop-portal-hyprland/).

> **For Astra/Hermes:** Implement this plan one phase at a time. Do not combine the Linux port and provider work into one giant change. Preserve the Windows build throughout.

**Goal:** Make Shade reliable on Omarchy's Arch Linux + Hyprland/Wayland environment first, then add OpenCode Zen, OpenCode Go, and direct DeepSeek as first-class providers.

**Priority order:**

1. Linux/Omarchy support
2. OpenCode Zen
3. OpenCode Go
4. Direct DeepSeek

**Architecture:** Introduce small platform and provider abstractions around the existing Electron application instead of scattering `process.platform` checks throughout the code. Treat Wayland screen capture, global shortcuts, overlay behavior, secure credential storage, and packaging as separate compatibility gates. Reuse the existing provider interfaces, but do not pretend all OpenAI-compatible models use the same endpoint or support images.

**Current project facts:**

- Electron app, currently described and packaged as Windows-only.
- Current entry point: `src/main/main.js`.
- Existing provider implementations: Gemini, OpenAI, Anthropic, and Custom.
- Existing provider/config core: `src/services/llm-factory.js`, `src/services/llm-service.js`, `src/services/provider-registry.js`, `src/services/model-refresh.js`, and `src/services/config-service.js`.
- Current screen capture: `src/services/screen-capture.js`, backed by `screenshot-desktop`.
- Current window management: `src/main/windows/window-manager.js`.
- Current package version at planning time: `0.15.1`.
- Preserve all existing Windows behavior and tests.

---

## Scope decisions

### In scope

- Omarchy on Arch Linux, using Hyprland and Wayland, is the primary Linux target.
- Native Wayland execution is required; XWayland-only operation is not considered complete.
- Screenshot capture, the Shade overlay, global shortcuts, tray behavior, secure API-key storage, installation, and updates must be tested on the real Omarchy session.
- Keep Windows functional from the same codebase.
- Add OpenCode Zen, OpenCode Go, and direct DeepSeek with streaming, screenshot input where the selected model supports vision, model selection, key storage, verification, and useful errors.

### Deferred

- macOS support.
- Broad certification across Ubuntu, Fedora, GNOME, KDE, and every Wayland compositor.
- Publishing an AUR package. Start with a locally installable AppImage and/or unpacked Linux build; add AUR packaging after the application itself is proven.
- X11-specific polish unless it falls out cheaply from the platform abstraction.
- New unrelated Shade features.

---

# Phase 0 — Establish a clean baseline

## Task 0.1: Protect the current Windows build

**Files to inspect:**

- `package.json`
- `src/main/main.js`
- `src/main/windows/window-manager.js`
- `src/services/screen-capture.js`
- `src/main/__tests__/tray.test.js`
- `src/services/__tests__/screen-capture.test.js`

**Steps:**

1. Run the full test suite on Windows and record the exact result.
2. Run `npm run build:win` and verify the installer artifact is produced.
3. Launch the unpacked Windows application and smoke-test:
   - Overlay show/hide
   - Existing global shortcuts
   - Manual and automatic screenshot capture
   - Streaming and cancellation
   - Model switching
   - Tray actions
4. Commit only after the baseline is documented.

**Acceptance:** We have a known-good Windows result to compare against after every Linux change.

## Task 0.2: Inventory platform assumptions

Search the codebase for Windows-only paths, binaries, APIs, icons, installer assumptions, registry usage, shortcut handling, content protection, screen enumeration, tray behavior, auto-start, and update behavior.

Create a short compatibility matrix in this file or a linked evidence document with columns for Windows, Omarchy/Wayland, fallback, and test status.

---

# Phase 1 — Create platform boundaries

## Task 1.1: Add a platform-services layer

**Likely files:**

- Create: `src/services/platform/platform-service.js`
- Create: `src/services/platform/windows-platform.js`
- Create: `src/services/platform/linux-platform.js`
- Add focused tests under `src/services/platform/__tests__/`
- Modify callers in `src/main/main.js`, `src/main/windows/window-manager.js`, and `src/services/screen-capture.js`

The platform layer should own:

- Screen capture strategy
- Global shortcut registration capabilities
- Content-protection capability reporting
- Tray availability
- Secure-storage availability and diagnostics
- Platform-specific app/window metadata

Do not create a giant god object. Keep narrow interfaces and inject them into existing services where practical.

## Task 1.2: Make platform limitations explicit

The UI must never claim a protection or capability that the current platform cannot provide. In particular, do not claim Linux screen-share invisibility unless it is actually demonstrated under Hyprland/Wayland and the tested capture applications.

**Acceptance:** Unsupported capabilities are disabled or labeled accurately rather than silently failing.

---

# Phase 2 — Make Shade run on Omarchy/Wayland

## Task 2.1: Add Linux build targets

**Modify:** `package.json`

Add a Linux configuration without weakening the Windows configuration:

- Linux icon(s)
- Category and executable metadata
- AppImage as the first distributable target
- Optional unpacked directory or tarball for debugging
- Linux artifact naming that does not reuse `Shade-Setup-*`
- Correct native-module packaging for each operating system

Add scripts such as `build:linux` while keeping `build:win` intact.

**Acceptance:** A Linux artifact builds on Arch/Omarchy, launches, and does not contain Windows-only native binaries as its active capture implementation.

## Task 2.2: Implement Wayland-native screen capture

**Modify:** `src/services/screen-capture.js`

**Likely create:**

- `src/services/capture/windows-capture.js`
- `src/services/capture/wayland-capture.js`
- Corresponding tests

Use Electron/Chromium's PipeWire + XDG Desktop Portal capture path for Wayland. Do not shell out to a screenshot command as the primary architecture unless portal capture proves impossible and the fallback is clearly isolated.

Requirements:

- Manual screenshots work in a real Hyprland Wayland session.
- Auto/predictive capture does not repeatedly trigger unusable permission dialogs.
- Cancellation and timeout behavior are deterministic.
- Single-monitor and multi-monitor behavior is documented. Electron notes that PipeWire may expose a single source; design around the observed behavior instead of assuming Windows source enumeration semantics.
- Capture failures return actionable errors naming PipeWire/portal/permission problems.
- Screenshot dimensions and scaling remain correct at Omarchy's 1x, fractional, and 2x display scales.

**Acceptance:** Shade can capture the intended display repeatedly during one session and send the image successfully to a vision-capable model.

## Task 2.3: Validate the overlay under Hyprland

**Modify:** `src/main/windows/window-manager.js` and platform-specific window setup.

Test and fix:

- Transparent background
- Always-on-top behavior
- Floating behavior under a tiling compositor
- Focus and click-through behavior
- Show/hide without stealing focus unexpectedly
- Correct placement on multiple monitors
- Fractional scaling
- Workspace changes
- No accidental taskbar/dock clutter

Prefer sane application metadata/window properties. Add an optional documented Hyprland window rule only if the compositor cannot infer the needed behavior; do not make users manually patch Omarchy before the app has attempted normal Electron behavior.

## Task 2.4: Make global shortcuts work on Wayland

Electron routes Wayland global shortcuts through `org.freedesktop.portal.GlobalShortcuts`. Configure the application identity/desktop file correctly and test the portal flow on Omarchy.

Requirements:

- Existing shortcuts register or fail with an explicit diagnostic.
- Registration does not silently work only while Shade is focused.
- User-approved portal bindings survive as expected.
- Shortcut conflicts are reported.
- Add a fallback document for Hyprland `bind ... exec ...` integration only if portal support is insufficient.

## Task 2.5: Verify tray and lifecycle behavior

Test Electron's tray implementation against Omarchy's Waybar/StatusNotifier setup.

Requirements:

- Icon appears or Shade provides another discoverable control surface.
- Show, hide, settings, and quit work.
- Closing the overlay does not orphan the process unexpectedly.
- Login/autostart behavior uses Linux/XDG conventions and is opt-in.

## Task 2.6: Harden secure credential storage on Linux

**Modify:** `src/services/config-service.js` and its tests.

Linux `safeStorage` may depend on an available Secret Service/keyring. Shade must not silently downgrade API keys to plaintext.

Requirements:

- Detect and report unavailable secure storage.
- Preserve the explicit encrypted-value marker approach from the hardening backlog.
- Offer a clear setup/error path rather than silently storing plaintext.
- Verify behavior after reboot and after a keyring is locked.

## Task 2.7: Linux smoke-test matrix

Run on the actual Omarchy installation, not only WSL and not only CI:

- Fresh install
- First launch
- Portal permission flow
- Repeated screenshots
- Auto capture
- Overlay show/hide and focus
- Every global shortcut
- Tray and quit
- API-key save/read/delete
- One full text-only conversation
- One screenshot conversation
- Streaming stop/cancel
- App relaunch and session restoration
- Multi-monitor behavior, if a second display is available
- 1x/fractional/2x scaling as available

**Linux port exit gate:** Michael can install Shade on Omarchy and use the core screen-assistant loop for a normal session without opening a terminal or editing config files.

---

# Phase 3 — Normalize provider capabilities

Do this after the Linux exit gate passes.

## Task 3.1: Extend provider metadata

**Modify:**

- `src/services/provider-registry.js`
- `src/services/model-refresh.js`
- `src/services/llm-factory.js`
- Provider-related tests

Represent capabilities explicitly instead of assuming every model behaves the same:

- API protocol: OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, or Google-compatible
- Vision/image input
- Streaming
- Reasoning options
- Model-list refresh support
- Required headers
- Provider/model availability status

Shade is screen-reading software. Only models confirmed to accept image input should be selectable for screenshot requests. A text-only model may remain available for text-only chats only if the UI makes that distinction obvious.

## Task 3.2: Consolidate model truth

The prior audit found three competing model sources: registry defaults, provider `getModels()`, and model refresh. Make one source authoritative and treat fetched model data as a cache/update layer. Provider additions must not add a fourth source of truth.

---

# Phase 4 — Add OpenCode Zen

## Task 4.1: Implement Zen as a first-class provider

**Likely files:**

- Create: `src/services/providers/opencode-zen-provider.js`
- Modify: `src/services/llm-factory.js`
- Modify: `src/services/provider-registry.js`
- Modify configuration UI and API-key verification
- Add provider and integration tests

OpenCode Zen is not one universal OpenAI Chat Completions endpoint. Its official API routes model families through different protocols:

- OpenAI-style Responses: `https://opencode.ai/zen/v1/responses`
- Anthropic Messages: `https://opencode.ai/zen/v1/messages`
- OpenAI-compatible Chat Completions: `https://opencode.ai/zen/v1/chat/completions`
- Google-compatible model routes for Gemini-family models

Create a protocol adapter/dispatcher rather than forcing every Zen model through `CustomProvider`.

Requirements:

- API key can be saved, cleared, and verified.
- Model metadata comes from the official model endpoint where practical, with a safe bundled fallback.
- Model lists are filterable by Shade-relevant capabilities, especially vision.
- Streaming and cancellation work for each protocol Shade exposes.
- Errors distinguish authentication, billing/credits, unsupported image input, rate limits, and upstream failures.

**Initial Shade default candidate:** a model explicitly documented as vision-capable. Do not assume a model accepts screenshots merely because it appears in Zen.

---

# Phase 5 — Add OpenCode Go

## Task 5.1: Confirm usage compatibility before shipping

OpenCode Go is documented primarily for OpenCode and coding-agent traffic. Shade is a general screen assistant, so verify that Shade's intended usage is permitted before publicly enabling this provider. Do not hand-wave this gate.

Go clients are expected to:

- Send an identifying User-Agent such as `shade/<version>`.
- Send a stable `x-opencode-session` value for each conversation.
- Preserve the session value across requests in the same Shade session.

## Task 5.2: Implement Go separately from Zen

**Likely create:** `src/services/providers/opencode-go-provider.js`

Do not model Go as a checkbox on Zen: it has separate subscription semantics, limits, model availability, and endpoint prefixes.

Official endpoint families use the `https://opencode.ai/zen/go/v1/` base with protocol-specific routes such as `messages` and `chat/completions`.

Requirements:

- Separate provider entry and clear subscription labeling.
- Correct protocol dispatch per model.
- Stable per-conversation session header.
- Shade-specific User-Agent.
- Vision-capability filtering.
- Clear messages for subscription/limit exhaustion.
- Tests assert required headers without making live paid calls.

**Acceptance:** A permitted, vision-capable Go model completes a real screenshot request in Shade, and a text-only model is not accidentally offered for screenshot mode.

---

# Phase 6 — Add direct DeepSeek

## Task 6.1: Implement direct DeepSeek

DeepSeek officially supports both:

- OpenAI-compatible base URL: `https://api.deepseek.com`
- Anthropic-compatible base URL: `https://api.deepseek.com/anthropic`

Initial official model IDs at planning time:

- `deepseek-v4-flash`
- `deepseek-v4-pro`
- `deepseek-v4-flash-vision-exp`

Only `deepseek-v4-flash-vision-exp` is explicitly documented as accepting image input. Do not present the text-only models as screen-capable.

Prefer the existing OpenAI-compatible provider path if it correctly supports DeepSeek streaming, image blocks, reasoning fields, cancellation, and errors. Otherwise add a thin DeepSeek adapter; do not duplicate the entire OpenAI provider.

Requirements:

- Direct DeepSeek key storage and verification.
- Text and vision capability metadata.
- Screenshot request test using the vision model.
- Streaming/cancellation tests.
- Helpful handling for experimental-model removal or renamed models.
- Model updates should not require editing several hardcoded lists.

---

# Test and release gates

## Automated tests

For every phase:

1. Write or update tests before changing behavior.
2. Run the focused test and verify the expected failure.
3. Implement the smallest passing change.
4. Run the focused tests.
5. Run `npm run test:run`.
6. Build the affected platform artifact.
7. Re-run the Windows regression build before merging Linux changes.

Mock network calls. Live paid-provider checks belong in an explicit opt-in smoke script and must never run in the default test suite.

## Manual provider matrix

For Zen, Go, and DeepSeek, verify:

- Invalid key
- Valid key
- Empty/expired balance or subscription
- Text-only request
- Screenshot request with supported model
- Screenshot request with unsupported model
- Streaming
- Stop/cancel
- Model switch
- Relaunch with saved key
- Rate-limit/upstream error

## Merge order

Use separate branches/commits for:

1. Platform abstractions
2. Linux packaging
3. Wayland capture
4. Hyprland overlay/shortcuts/tray
5. Linux secure storage and smoke tests
6. Provider capability model
7. OpenCode Zen
8. OpenCode Go
9. Direct DeepSeek

Do not stack all of this into one heroic PR. Heroic PRs are how bugs acquire squatter's rights.

---

# Definition of done

## Linux/Omarchy

- Shade installs and launches natively on Omarchy.
- Core screenshot-to-answer flow works repeatedly under Hyprland/Wayland.
- Overlay, focus, shortcuts, tray, scaling, and secure key storage behave predictably.
- Windows still passes its tests and produces its installer.
- Linux limitations are stated honestly in the UI/docs.

## Providers

- Zen, Go, and DeepSeek appear as distinct providers.
- Keys are stored securely and verified.
- Protocol differences are handled deliberately.
- Model lists have one source of truth and capability metadata.
- Screenshot mode exposes only models confirmed to support image input.
- Streaming, cancellation, errors, and session persistence are covered by tests.
- Go's usage-policy/session-header requirements are satisfied before public release.

---

# Research references

- Omarchy manual: https://learn.omacom.io/2/the-omarchy-manual/
- Electron global shortcuts: https://www.electronjs.org/docs/latest/api/global-shortcut
- Electron desktop capture: https://www.electronjs.org/docs/latest/api/desktop-capturer
- OpenCode Zen: https://opencode.ai/docs/zen
- OpenCode Go: https://opencode.ai/docs/go
- DeepSeek API: https://api-docs.deepseek.com

These services and model lists change quickly. Re-check the official pages immediately before implementing each provider rather than treating this plan as eternal scripture.
