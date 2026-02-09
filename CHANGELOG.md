# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.12.1] - 2026-02-09

### Added
- Integrated display-aware screen capture: screenshots now target the display where the app window is currently located.
- Robust keyboard shortcut registration: added a fallback warning dialog to inform users if global shortcuts (like `Ctrl+/` or `Ctrl+M`) fail to register due to system conflicts.
- Enhanced telemetry for message sending: improved logging in the main process to track message size, history length, and image presence for better debugging.
- Included `appicon.png` in the production build assets.

### Changed
- Refactored screen capture service to support preferred display targeting.
- Updated hotkey registration logic to be more resilient and informative.

## [0.12.0] - 2026-02-08


### Added
- Atomic write utility for sync/async persistence operations (`src/services/utils/atomic-write.js`) plus dedicated utility tests.
- Safe JSON parse utility with explicit fallback behavior (`src/services/utils/json-safe.js`) plus unit tests.
- Model refresh resilience tests for malformed provider payloads (`src/services/__tests__/model-refresh.test.js`).

### Changed
- Migrated provider/config/session persistence paths to atomic write flows to reduce corruption risk on interrupted writes.
- Migrated service JSON parsing in provider registry, config loading, session loading, and model refresh responses to guarded parsing.
- Expanded service-level durability coverage in config/session tests for malformed JSON handling.

### Fixed
- Prevented malformed config/session JSON from crashing normal startup/load flows by using safe fallback parsing.
- Reduced risk of partially-written provider/config/session files by writing through temp-then-rename atomic operations.

## [0.11.4] - 2026-02-08

### Added
- Comprehensive LaTeX support including display math in fenced blocks (`latex`/`tex`/`math`) and improved regex for inline/display delimiters.
- Unit tests for LaTeX rendering and system prompt safety.

### Changed
- Redesigned code block UI with a dedicated header for language labels and copy buttons for better readability.
- CI/CD workflow optimized for more reliable GitHub releases by separating the build and release steps.
- Updated system prompts to be more explicit about LaTeX formatting requirements.

### Fixed
- Fixed LaTeX backslash normalization to preserve matrix line breaks (`\\`).
- Improved UI responsiveness by auto-sizing input field after sending messages or starting new chats.

## [0.11.3] - 2026-02-07

### Added
- New "Response interrupted" notification in the chat UI when a message generation is stopped.

### Changed
- Improved reliability of message generation stoppage with better error handling and state reset.
- Repositioned the update notification button in the title bar for better visibility.
- Configured GitHub publisher to use full "release" type for production builds.

### Fixed
- Fixed UI state inconsistency where the input bar could remain in a "generating" or "thinking" state after a manual stop or error.
