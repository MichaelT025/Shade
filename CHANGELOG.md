# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.0] - 2026-02-10

### Added
- Predictive screenshot caching system for instant screen capture with zero-latency AI assistance
- Overlay visibility control - configure whether Shade appears in screenshots via Dashboard settings
- Enhanced window show/hide coordination between main and renderer processes

### Fixed
- Eliminated window reveal flicker by managing CSS transitions and compositor state during show/hide
- Fixed visual artifacts and timing issues when rapidly toggling overlay visibility
- Removed title-bar backdrop-filter to prevent compositor thrash on window show

### Changed
- Improved predictive capture scheduling with document.hidden checks to avoid stale screenshots
- Enhanced visibility logging for debugging reveal timing issues

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

## [0.11.4] - 2026-02-07

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
