# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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
