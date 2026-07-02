# Shade Pre-Launch Audit

**Combined audit** — merges the Opus codebase audit (2026-06-23, logged in the Obsidian vault) with a second independent full-source audit (Fable, 2026-07-02). Every Opus claim was re-verified against source; corrections are marked. All ~10.4k lines of `src/` were read, and the test suite re-run (**288 passed / 15 skipped**).

Legend: `[Opus]` = original audit, `[Fable]` = new finding, `[Both]` = found by Opus, extended/confirmed with new detail.

---

## 1. General rundown

The fundamentals are good. Electron security posture is above average for an indie app: `contextIsolation` on, `nodeIntegration` off, strict CSP (`script-src 'self'`), navigation guards, protocol-validated `shell.openExternal`, atomic file writes, path-traversal guards on session/screenshot IO, `safeStorage` key encryption, and no `eval`/`child_process` anywhere. Tests are real and green. There is **no actively exploitable critical hole in the current Windows build**.

The pre-launch work concentrates in five areas:

1. **Broken first-run** — new users get retired default model IDs and their first message 404s. Cheapest, highest-impact fix in this document.
2. **Streaming/abort state machine** — a cluster of races around stop, new-chat, and session-resume that can cancel the wrong request or write another session's reply into the current one.
3. **Trust & privacy promises** — "Delete Everything" doesn't delete everything (README explicitly promises a full wipe), keys can silently fall back to plaintext, no code signing.
4. **UX landmines** — Shade steals Ctrl+R / Ctrl+M system-wide while the overlay is visible, single-click session delete has no confirmation, several settings fail silently.
5. **Structural debt** — `homepage.js` (2,352 lines), `app.js` (1,921 lines), `index.html` (~1,180 lines of inline CSS), and `config-service.js` (830 lines) each mix multiple responsibilities. The refactor plan is in §7 and should land *after* the correctness fixes so behavior changes don't hide inside file moves.

**Correction to the Opus audit worth knowing up front:** "Stop leaves an orphaned forever-blinking bubble and the partial reply is never saved" is not what actually happens. Every provider swallows the abort error (`catch → return`), so `streamResponse()` resolves normally, main still emits `message-complete`, and the renderer finalizes and persists the partial reply. The *real* bugs in that cluster are the controller-ownership race, Gemini's non-cancelling stop, and the missing request-generation token (§3.1). Second correction: the dashboard window is *destroyed* by its close button (`window-ipc.js:53-58`), not hidden — it is only hidden when resuming a session into the overlay.

Also verified before refactoring: remote branches `bugfix` and `multi_monitor` carry WIP. Reconcile or cherry-pick them **before** the §7 file splits, or that work will need painful rebasing.

---

## 2. Security & privacy

### 2.1 No code signing — start cert procurement NOW `[Opus]` — **HIGH**
- **Where:** `package.json` build config (`verifyUpdateCodeSignature: false`), `.github/workflows/release.yml` (no signing step).
- **Problem:** Unsigned installer → SmartScreen "unknown publisher" wall for every new user; auto-updates are authenticated only by GitHub HTTPS + SHA512, with no publisher signature check.
- **Fix:** Procure an OV/EV code-signing cert (or use Azure Trusted Signing — cheaper, works with electron-builder). Add a signing step to `release.yml`, flip `verifyUpdateCodeSignature` to `true`. **Lead time is weeks — this is the first thing to kick off even though it's not code.**

### 2.2 "Delete Everything" doesn't delete everything `[Fable]` — **HIGH (trust)**
- **Where:** `src/main/ipc/session-ipc.js:91-112` (`delete-all-data`), dashboard modal ("Delete Everything"), `README.md:123` ("can be deleted any time (including a full wipe from the Dashboard)").
- **Problem:** The handler iterates `getAllSessions()` and deletes each session. It does **not** touch `config.json` (API keys, modes, settings), `providers.json`, or orphaned screenshot directories. Worse: `getAllSessions()` silently skips corrupt session files, so their JSON and screenshots survive the "wipe" too. This contradicts a written privacy promise.
- **Fix:** Make `delete-all-data` remove the whole `data/` tree (sessions + screenshots dirs wholesale, not per-session), plus optionally offer a separate "also clear API keys & settings" checkbox that calls `configService.clearAll()` (after fixing §3.3). Recreate empty dirs afterward. Update the modal copy to state exactly what is removed.

### 2.3 API keys silently fall back to plaintext `[Opus]` — **MED**
- **Where:** `src/services/config-service.js:329-340` (`encryptKey`).
- **Problem:** If `safeStorage.isEncryptionAvailable()` is false or `encryptString` throws, the plaintext key is written to `config.json` with no user-visible warning. Critical for the planned Linux port (keyrings are often absent).
- **Fix:** Surface encryption state through an IPC (`get-encryption-status`), show a persistent warning banner in the API-key card when storing unencrypted, and consider refusing to store with an explicit "store anyway (plaintext)" opt-in.

### 2.4 Key encryption is guess-based and can corrupt keys `[Both]` — **MED**
- **Where:** `src/services/config-service.js:403-447` (auto-encrypt heuristic on load), `:347-362` (`decryptKey`).
- **Problem (Opus):** On load, any key that fails `decryptString` is assumed plaintext and re-encrypted. A key encrypted on another machine / OS user / after a keychain reset fails decryption → gets **double-encrypted** → unrecoverable, with silent auth failures.
- **Problem (Fable, sibling path):** The reverse flip — encrypted at save, `safeStorage` unavailable at load — makes `decryptKey` return the **base64 ciphertext as if it were the key**, which is then sent as an Authorization header. Garbage credentials, silent 401s.
- **Fix:** Stop guessing. Store an explicit marker: `enc:v1:<base64>` for encrypted values, bare string for plaintext. Then: marker + decrypt fails → tell the user "key can't be decrypted on this machine, please re-enter" instead of corrupting or transmitting ciphertext. Migrate existing values once, keyed off the marker's absence.

### 2.5 Stored key material round-trips through the renderer `[Fable]` — **MED**
- **Where:** `src/main/ipc/config-ipc.js:49-57` (`get-provider-config` returns the raw provider object incl. `apiKey`), consumed at `src/renderer/homepage.js:1835-1837` and `src/renderer/app.js:124` and passed back via `set-provider-config`.
- **Problem:** The renderer receives the stored key blob on every config read. Normally that's ciphertext, but when §2.3's fallback is active it's the **plaintext key living in renderer memory** — exactly the process a markdown-rendering XSS (see §2.6) would compromise. It also means `set-provider-config` can overwrite `apiKey` from the renderer, bypassing `encryptKey` (a plaintext value written through this path is stored as-is).
- **Fix:** In `get-provider-config`, return `{...config, apiKey: undefined, hasApiKey: !!config.apiKey}`. In `setProviderConfig`, ignore/strip an incoming `apiKey` field — key writes go through `save-api-key` only. Renderer call sites already use `hasApiKey` separately, so this is low-friction.

### 2.6 Markdown sanitizer fails open `[Opus]` — **MED**
- **Where:** `src/renderer/utils/rendering-adapter.js:180-188` (`renderMarkdownSafe`).
- **Problem:** If DOMPurify isn't on `globalThis` (vendoring regression, load-order change), the function returns raw `marked.parse()` HTML. Not exploitable today (verified DOMPurify loads in the packaged build), but it's XSS-on-regression with real blast radius — the preload exposes `openExternal`, `saveApiKey`, `deleteAllData`.
- **Fix:** Fail closed — if `getDOMPurify()` returns null, return escaped text (reuse `escapeHtml`) instead of the raw HTML. One-line change plus a test asserting the closed behavior. Becomes even more important once §8.1 changes how vendors load.

### 2.7 `file://` navigation allowance is too broad `[Fable]` — **LOW**
- **Where:** `src/main/windows/window-manager.js:4-6` (`isAllowedInternalUrl`).
- **Problem:** `will-navigate` permits navigation to **any** `file://` URL (and any `http://localhost*`), not just the app's own renderer files. Defense-in-depth gap: a compromised renderer could navigate itself to arbitrary local files.
- **Fix:** Allow only URLs that resolve inside `rendererPath` (compare normalized `fileURLToPath` prefix). Keep localhost only for dev (`!app.isPackaged`).

### 2.8 IPC sender validation is inconsistent `[Opus]` — **LOW**
- **Where:** Only `get-app-version` validates `event.senderFrame.url` (`src/main/ipc/system-ipc.js:83-90`); every other handler trusts the sender.
- **Fix:** Extract that check into a shared `assertTrustedSender(event)` helper and apply it in each `ipcMain.handle` registration (or wrap the registrar). Low urgency while navigation is locked down, but cheap consistency.

### 2.9 Google Fonts loaded from CDN `[Opus]` — **LOW**
- **Where:** `src/renderer/index.html:16-18` (+ `style-src`/`font-src` CSP allowances in all three HTML files).
- **Problem:** Contradicts "nothing leaves your machine except API calls," breaks typography offline, and is a third-party request on every launch.
- **Fix:** Self-host Space Grotesk + JetBrains Mono woff2 files under `src/renderer/assets/fonts/`, drop the CDN `<link>`s and the CSP allowances for `fonts.googleapis.com`/`fonts.gstatic.com`.

---

## 3. Correctness bugs

### 3.1 Streaming/abort state machine (cluster) `[Both]` — **HIGH**
The single most important code fix before launch. Four interlocking problems:

**(a) Controller-ownership race** `[Opus — confirmed]`
- **Where:** `src/main/ipc/chat-ipc.js:152-155` and `:222-224`.
- `send-message` aborts any existing controller, creates a new one, and in `finally` does `currentAbortController = null` — unconditionally. If request B starts while request A is finishing, A's `finally` nulls **B's** controller → Stop can no longer cancel B.
- **Fix:** capture `const mine = currentAbortController` and only null if still owner: `if (currentAbortController === mine) currentAbortController = null`.

**(b) No request-generation token** `[Opus — confirmed, mechanism corrected]`
- **Where:** `chat-ipc.js:205-209` (chunk emission), `src/renderer/app.js:1258-1318` (chunk/complete/error handlers).
- Chunks are sent on a bare `message-chunk` channel with no ID. Any late chunk/complete/error from a superseded request is applied to whatever the renderer is currently showing.
- **Fix:** main assigns a monotonically increasing `requestId` per `send-message`, includes it in every `message-chunk` / `message-complete` / `message-error`, and returns it from the invoke. Renderer stores the ID of the request it's rendering and drops events for any other ID. This one change structurally kills the whole class.

**(c) New-chat / resume-session mid-stream doesn't abort** `[Fable]`
- **Where:** `src/renderer/app.js:1803-1846` (`handleNewChat`), `:147-249` (`loadSessionIntoChat`).
- Neither calls `stopMessage()` nor resets `isGenerating` / `currentStreamingMessageId` / `accumulatedText` / `currentLoadingId`. Consequence: press Ctrl+R (or resume a session from the dashboard) while a reply is streaming → the old request's chunks render into the **new or resumed chat**, get finalized there, and `scheduleSessionSave()` **persists another conversation's reply into the wrong session file**.
- **Fix:** both entry points call `await window.electronAPI.stopMessage()` and fully reset streaming state before rebuilding the DOM. With (b) in place, also bump the accepted `requestId` so stragglers are dropped.

**(d) Gemini "Stop" doesn't cancel the request** `[Opus — confirmed]`
- **Where:** `src/services/providers/gemini-provider.js:98-112`.
- The abort signal is only checked between chunks (`if (signal?.aborted) break`) — the underlying HTTP request keeps running and billing.
- **Fix:** pass the signal into the SDK (current `@google/generative-ai` accepts `{ signal }` as request options on `generateContentStream`; if the pinned version doesn't, wire the abort to destroy the underlying stream, or migrate to the newer `@google/genai` SDK which supports `abortSignal`).

**(e) Correction to Opus:** "Stop leaves an orphaned forever-blinking bubble; partial reply never saved" — **not reproducible in code.** All four providers catch abort errors and `return` (e.g. `openai-provider.js:141-145`), so `streamResponse` resolves, `chat-ipc.js:209` still sends `message-complete`, and the renderer finalizes + saves the partial. What *is* true: the renderer's Stop path (`app.js:1052-1062`) resets the button before `message-complete` lands, and the "Response interrupted" notice can interleave oddly with finalization. With (b)'s requestId plumbing, make Stop deterministic: renderer marks the request stopped, finalizes the partial itself, and ignores the trailing complete event.

### 3.2 First-run default models are retired IDs `[Fable]` — **HIGH**
- **Where:** `src/services/provider-registry.js:18` (`defaultModel: 'gemini-2.0-flash-exp'`), `:88` (`grok-vision-beta`), `:102` (`anthropic/claude-3.5-sonnet` for OpenRouter); embedded default model *lists* on the same objects are equally stale (`gemini-1.5-*`, `o1`, `grok-2-vision-1212`).
- **Problem:** `generateDefaultProvidersConfig()` (`provider-registry.js:322-341`) bakes `defaultModel` into every new user's `config.json` as their **selected model**. The startup model refresh updates the registry's model *list* but never the user's *selection*. `gemini-2.0-flash-exp` and `grok-vision-beta` no longer exist upstream → a fresh install with a valid key gets an API error on the very first message. This is the worst possible first impression and a two-line fix.
- **Fix:** (1) update `defaultModel` values to current stable IDs (`gemini-2.5-flash`, a live Grok vision model, current OpenRouter default); (2) add a heal step: after a successful model refresh, if the user's selected model is absent from the fetched list, fall back to `defaultModel` (and if *that* is absent, first vision-capable model) and toast the change; (3) refresh the embedded fallback lists while there (also §7.6).

### 3.3 Config defaults are mutated through shared references `[Fable]` — **HIGH**
- **Where:** `src/services/config-service.js:459` (`loadConfig` error fallback `{ ...this.defaultConfig }`), `:561` (`clearAll()` same shallow spread), `:571-575` and `:582-587` (`getModes()` assigns `this.config.modes = this.defaultConfig.modes` — same array reference).
- **Problem:** A shallow spread copies only the top level; `providers`, `modes`, `memorySettings`, etc. remain **shared objects** with `defaultConfig`. Concretely: after `clearAll()`, `setApiKey()` writes the key into `defaultConfig.providers.<id>.apiKey`; after `getModes()` seeds defaults, editing a built-in mode's prompt (via `saveMode`, which replaces an element of the shared array) **mutates the in-memory factory defaults** — so "Reset to Default" restores the *edited* prompt until app restart, and `getDefaultModes()` lies.
- **Fix:** Deep-clone at every defaults hand-off: `structuredClone(this.defaultConfig)` (or the existing `JSON.parse(JSON.stringify(...))` idiom already used correctly in `resetModesToDefault`, `:669`). Audit all `this.defaultConfig.X` assignments in the file — there are ~8. Add a regression test: edit a default mode, reset, assert factory prompt returns.

### 3.4 Overlay shortcuts hijack the whole OS `[Fable]` — **HIGH (UX)**
- **Where:** `src/main/main.js:98-142` (`registerOverlayShortcuts`), called from `showMainWindow`.
- **Problem:** `Ctrl+R`, `Ctrl+'`, `Ctrl+Shift+S`, and `Ctrl+M` are registered as **OS-global** shortcuts whenever the overlay is visible. The overlay's entire purpose is to float above other apps while you work in them — so during normal use, Ctrl+R in Chrome starts a Shade chat instead of reloading the page, and Ctrl+M is stolen from every application. Users will experience this as "Shade broke my browser."
- **Fix:** Global registration is only appropriate for the summon hotkey (`Ctrl+/`). For the rest, handle them only when a Shade window is focused — either via `webContents.on('before-input-event')` in main, or plain `keydown` handlers in the renderer (the input is focused by default, so this covers the real use case). If "works while unfocused" is genuinely wanted, make it an off-by-default setting and pick less contested chords. Note `unregisterOverlayShortcuts` on hide (`main.js:145-150`) already implies awareness — visibility isn't focus.

### 3.5 Mode switching: renderer ignores `overrideProviderModel` `[Fable]` — **MED**
- **Where:** `src/renderer/app.js:1886-1900` (`handleModeSwitch` applies `mode.provider` whenever set), vs. `src/main/ipc/config-ipc.js:230-252` (`set-active-mode` correctly gates on `mode?.overrideProviderModel`). Aggravator: dashboard "New Mode" always stamps `provider: cachedActiveProvider` (`src/renderer/homepage.js:1248-1256`).
- **Problem:** Every custom mode carries a `provider` value, so switching to one from the overlay dropdown **force-switches the global active provider even when the override toggle is OFF** — then main's handler and the renderer disagree about what just happened. There are effectively three writers of the provider/model sync (renderer `handleModeSwitch`, main `set-active-mode`, main `save-mode` + `set-provider-config` back-sync at `config-ipc.js:64-77` / `:165-186`).
- **Fix:** Single writer: delete the provider/model application block from `handleModeSwitch` entirely (main's `set-active-mode` already does it, correctly gated) and stop stamping `provider` on newly created modes. Review the two back-sync blocks in `config-ipc.js` and keep at most one direction (mode → provider on activation) to avoid ping-pong writes.

### 3.6 Long conversations silently lose their middle `[Fable]` — **MED**
- **Where:** `src/renderer/utils/memory-manager.js:163-169` (`shouldRegenerateSummary` — **never called anywhere**), `getContextForRequest()` (`:101-115`).
- **Problem:** After the first summary is generated, `shouldGenerateSummary()` is permanently false (`!this.summary`). Context becomes `summary + last N messages`; everything that accumulates **between** the summarized prefix and the sliding window is dropped from context forever. In a 60-message chat with `historyLimit=10`, messages ~16–50 are invisible to the model.
- **Fix:** Wire the existing method: in `handleSendMessage`'s summary block (`app.js:1161-1176`), also trigger when `shouldRegenerateSummary()` is true, and have `generateSummary` fold the *previous summary + newly aged-out messages* into a fresh summary (pass the old summary text into the prompt). Update `summary.messageCount` accordingly.

### 3.7 Model switcher commits provider on browse, not on confirm `[Opus — confirmed]` — **MED**
- **Where:** `src/renderer/model-switcher.js:328-352` (`handleProviderChange` → `setActiveProvider` immediately on dropdown change); window closes on blur (`window-manager.js:422-426`).
- **Problem:** Browsing providers in the Ctrl+M switcher and dismissing (blur/Esc) leaves the app on the browsed provider — possibly with a stale or empty model — without the user ever picking one.
- **Fix:** Treat the dropdown as a *view filter*: only call `setActiveProvider` inside the model-pick handler (where `setProviderConfig` already runs), or snapshot the original provider on open and revert on close-without-selection.

### 3.8 Silent failures on critical UI actions `[Opus — confirmed]` — **MED**
- **Where:** `src/renderer/homepage.js:1781-1804` (API key Save/Clear ignore the IPC result — "Saved." shows even on failure), `:1684-1742` (all settings toggles flip optimistically, no result check, no revert), `app.js` overlay nav calls (`openSettings`, `hideWindow`) fire-and-forget.
- **Fix:** Standard pattern everywhere: `const r = await call(); if (!r?.success) { revert UI state; setStatus/showToast(r?.error) }`. The key Save/Clear buttons are the priority (a failed key save that *says* Saved is a support-ticket generator).

### 3.9 Session delete: no confirm on single delete + dead menu branch `[Fable]` — **MED**
- **Where:** per-card trash button `src/renderer/homepage.js:503-506` → `handleDeleteSession` directly (bulk delete *does* confirm via modal, `:287-301`); context-menu handler processes a `'delete'` command (`homepage.js:2323`) that the menu template never offers (`session-ipc.js:165-179` has only Rename/Save).
- **Fix:** Route the single trash button through the existing `delete-sessions-modal` (count = 1). Either add a Delete item to the context menu (going through the same confirm) or remove the dead `'delete'` branch.

### 3.10 Predictive screenshot residue `[Both — largely mitigated, remnants]` — **LOW**
- **Where:** `src/renderer/app.js:1084-1122`, `src/main/ipc/chat-ipc.js:133-141`.
- **Status:** The orphan-cache problem Opus flagged is mostly addressed (cleanup moved to `finally`, commit `8e5192e`; renderer clears main's cache after every send). Remaining: (1) the 3s `Promise.race` timeout proceeds *without* consuming a capture that then completes and caches — harmless now but only because of the unconditional clear; (2) the `usePredictiveScreenshot` parameter through preload → `send-message` (`preload.js:13`, `chat-ipc.js:133-141`) is **dead code** — the renderer always consumes the cache itself via `consume-predictive-screenshot` and passes base64.
- **Fix:** Delete the dead parameter path (or move consumption fully into main and delete the renderer path — pick one). Single-flight is already enforced main-side via `captureInProgress`.

### 3.11 Smaller confirmed items `[Opus]` — **LOW**
- `Date.now()` DOM ids can collide under fast successive renders: `'loading-' + Date.now()` (`app.js:1398`), `'streaming-' + Date.now()` (`app.js:1444`), `'mode-' + Date.now()` (`homepage.js:1250`). Use the existing `generateMessageId()` (`session-client.js:1-3`).
- Registry model migration is add-only (`provider-registry.js:195-221`): default-list prunes never reach existing users' `providers.json`. Needs a versioned migration or "replace stale defaults on bump" strategy — prerequisite for the vault's "prune stale model entries" cleanup item.
- `generate-summary` (`chat-ipc.js:237-271`) uses the active provider but ignores an active mode's provider/model override (unlike `send-message` and `generate-session-title`) — summaries can bill a different provider than the chat. Also: neither summary nor title generation is abortable (no signal passed) — a slow summary blocks the send it precedes (`app.js:1161-1176` awaits it).
- Sessions are auto-deleted after 30 days unless saved (`session-storage.js:449-476`) — correct per PRD, but stated nowhere in the UI. Add one line to the dashboard sessions view ("Unsaved chats are removed after 30 days") so it reads as policy, not data loss.
- Auto-title races the next message: `maybeAutoTitleSessionFromFirstReply` fires an LLM call concurrently with user activity using the *current* provider config; harmless today but folds into the §3.1 requestId work if title generation ever streams.

---

## 4. Performance

### 4.1 O(n²) streaming re-render `[Fable]` — **MED**
- **Where:** `src/renderer/app.js:1471-1499` (`updateStreamingMessage`) — every chunk re-runs `renderMarkdown()` over the **entire accumulated text**, resets `innerHTML`, and `addCopyButtons()` re-walks and re-highlights every `<pre code>` (`hljs.highlightElement`) in the message.
- **Problem:** For a long code-heavy answer arriving in hundreds of chunks, work per chunk grows linearly → total quadratic. Visible jank in Coder-mode answers; also thrashes the DOM (copy-button wrappers rebuilt constantly).
- **Fix:** Cheapest: throttle — accumulate chunks and re-render at most every ~50ms (`requestAnimationFrame` gate), always rendering on `message-complete`. Skip `highlightElement` on the trailing (still-open) code block during streaming. That alone flattens the curve; true incremental markdown rendering is not needed.

### 4.2 `max_tokens: 4096` hard cap in every provider `[Fable]` — **LOW/MED**
- **Where:** `openai-provider.js:130`, `anthropic-provider.js:117`, `custom-provider.js:131` (Gemini path sets none).
- **Problem:** Truncates long outputs — ironic for the built-in "Coder" mode whose job is complete implementations. Modern models comfortably support far higher completion limits.
- **Fix:** Raise the default (e.g. 8–16k) and make it a per-provider config field (`config.maxTokens`) so modes/settings can tune it. Surface truncation: when a stream ends with a length/`max_tokens` stop reason, append a "response truncated" notice.

### 4.3 IPC round-trip per keystroke in the mode editor `[Fable]` — **LOW**
- **Where:** `src/renderer/homepage.js:1302-1316` — the editor `input` listener calls `fetchModesState(true)` (two IPC calls) on **every keystroke** in the prompt textarea before scheduling the debounced save.
- **Fix:** Debounce first, fetch once inside the debounced save; or keep the edited mode in memory and only reconcile on blur/select.

### 4.4 59 MB `app.asar`; 898 highlight.js files shipped `[Opus]` — **MED**
- **Where:** `package.json` depends on **both** `highlight.js` and `@highlightjs/cdn-assets` (11.9.0); `index.html:26-27` loads the cdn-assets build (~190 languages × formats).
- **Fix:** Drop `@highlightjs/cdn-assets` entirely; import `highlight.js/lib/core` + the ~15 languages Shade realistically renders, registered explicitly. Do this as part of §8.1 (ESM vendoring) — together they are the bulk of the installer-size win.

---

## 5. UX / product consistency

### 5.1 Session subtitles show internal IDs `[Fable]` — **LOW**
- `renderSessionList` shows `session.mode` raw (`homepage.js:457-458`) — users see `bolt`, not "Bolt", because the overlay saves `modeDropdownInput.value` (the ID). Map ID → name at render (modes are already cached) or store the display name alongside.

### 5.2 Copy/typos `[Both]` — **LOW**
- "Recommended model: **Gemini Gemini 2.5 Flash**" (`homepage.js:958`).
- Recommendation for Thinker names "**OpenAI GPT-5.2**" (`homepage.js:961`) — a model that doesn't exist in any registry list. These hardcoded recommendation strings drift by design; either derive them from the registry or delete the feature.
- "shorcut" → "shortcut" (`homepage.js:1580`).
- README badge says 0.14.0, `package.json` is 0.15.0 (see §8.3 — automate).

### 5.3 Screenshot preview popup can strand `[Fable]` — **LOW**
- **Where:** `src/renderer/utils/screenshot-ui.js` — `hidePopup` only runs on `mouseleave`; if the anchor element is removed while hovered (new chat / session load replaces `messagesContainer.innerHTML`), the fixed-position popup stays on screen. Also `fetchPromise` caches a failed fetch forever (no retry).
- **Fix:** Remove any open popup when the chat container is rebuilt (export a `dismissAllPreviews()` and call it from `handleNewChat`/`loadSessionIntoChat`); null `fetchPromise` on failure.

---

## 6. Tests `[Opus — all confirmed]`

Current: 288 pass / 15 skip across 18 files. Real and green, but coverage is concentrated in pure services; the risky surfaces are untested.

1. **Encryption is untested — and the plaintext path is locked in.** `config-service.test.js:242-251` asserts that keys are stored *unencrypted* when `safeStorage` is unavailable (i.e., it enshrines §2.3). Add tests for: encrypt-on-save, decrypt-on-read, the §2.4 marker behavior, machine-mismatch handling. These tests are prerequisites for touching §2.4 safely.
2. **`tray.test.js` is tautological.** It never imports `window-manager.js` or `main.js`; it re-implements the logic inline and asserts against itself — false confidence. Rewrite against the real module (extract tray/menu creation into a testable factory first — pairs with §7.2).
3. **Skipped core paths:** `gemini-provider` send/stream (10 skips), `screen-capture.captureScreen` (5 skips). The Gemini streaming tests matter for §3.1(d) — unskip alongside that fix.
4. **Zero coverage:** all of `main/ipc/*`, `window-manager.js`, `update-service.js`, `preload.js`, `app.js`, `homepage.js`. The §3.1 fixes need at least chat-ipc tests (abort ownership, requestId gating) — write them with the fix, not after.
5. **`provider-verification.test.js` performs a real network call** (flaky offline/CI), and its `expect(async…).not.toThrow()` is a no-op (an async function never throws synchronously). Mock the transport; await the promise and assert resolution.

---

## 7. Refactoring plan (structural debt)

> Order matters: land the §2–§4 fixes **first** (small, reviewable diffs on today's layout), reconcile the `bugfix` / `multi_monitor` branches, **then** do the splits below. Refactoring first would force every bugfix to be re-found inside moved code.

### 7.1 Split `homepage.js` (2,352 lines) — **the big one**
Currently one module owning: session list + bulk selection, rename modal, delete modals (x3), first-run experience, update toasts, the entire Configuration view (~700 lines), the entire Modes view (~500 lines), model list rendering/search (duplicated twice within the same file — `updateModeModelList` vs `updateProviderDependentUI`), and app bootstrap. `homepage/` subdirs already exist (`services/`, `controllers/`) — extend that pattern:

```
homepage/
  index.js                    // bootstrap + wiring only (~150 lines)
  controllers/
    navigation-controller.js  // (exists)
    sessions-view.js          // list, grouping, bulk mode, empty states
    config-view.js            // provider/key/model cards + toggles
    modes-view.js             // list, editor, reset modals
    first-run.js
    update-ui.js              // toasts + status handling
  components/
    modals.js                 // generic open/close/confirm plumbing (5 near-identical modals today)
    model-list.js             // ONE model list w/ search+select, used by config-view AND modes-view
  services/
    homepage-helpers.js       // (exists)
    homepage-api.js           // (exists)
```
Also fixes along the way: the module-global soup (~17 globals — `showingSaved`, `selectedModeIdToDelete`, `cachedModes`, `renameModalTarget`… become per-controller state), dead `isFirstRunMode` (`homepage.js:224`), debug globals leaked to `window` (`:1992-1994`), and the giant functions Opus flagged (`initConfigurationView` ~330 lines, `renderConfig` ~190 → template extraction; `renderModeEditor` ~145).

### 7.2 Split `app.js` (1,921 lines)
Natural seams, most utilities already extracted to `utils/`:
```
overlay/
  index.js               // init + event wiring
  streaming.js           // chunk/complete/error handlers, requestId state (owns §3.1 fix)
  send-controller.js     // handleSendMessage decomposed (~200 lines today, 'Assist' computed 3×)
  screenshot-state.js    // manual + predictive capture state machine
  collapse.js            // collapse/expand/measure/height-sync (5 functions, own state)
  session-hydration.js   // loadSessionIntoChat / saveCurrentSession / auto-title
  chat-dom.js            // addMessage/addStreaming/finalize/copy buttons/error cards
```
Do the §3.1 streaming fix *first*, then move `streaming.js` — the requestId state machine is much easier to review as a diff in place. `handleSendMessage`'s duplicated auto-mode reset block (`app.js:1231-1245` copy-pastes `removeScreenshot`'s auto branch at `:1002-1013`) collapses into one helper during this split.

### 7.3 Extract inline CSS from `index.html` (~1,180 of 1,281 lines are `<style>`)
Move to `styles/overlay.css` next to the existing `tokens.css`/`components.css`. Zero-risk, big readability win, and makes §8.1's Vite handling uniform. Check `homepage.html`/`model-switcher.html` for the same pattern while there.

### 7.4 Split `config-service.js` (830 lines)
Four responsibilities in one class: (1) key encryption (§2.4's marker logic wants to be its own tested module → `services/key-vault.js`), (2) legacy config migration (`needsMigration`/`migrateConfig` → `services/config-migrations.js`), (3) default mode definitions — ~120 lines of prompt strings → `services/default-modes.js` data file, (4) the actual get/set config store. The §3.3 deep-clone fix becomes trivial to verify once defaults live in their own module with a `getDefaults()` that clones.

### 7.5 De-duplicate the model-switcher helpers `[Opus — confirmed]`
`src/renderer/model-switcher.js:4-64` copy-pastes `normalizeProvidersMeta`, `getProviderLabel`, `extractModelsFromProviderMeta`, `normalizeSearchText`, `scoreModelMatch` from `homepage/services/homepage-helpers.js` — and its `scoreModelMatch` is an **older version without token-based scoring**, so Ctrl+M search ranks differently than dashboard search for multi-word queries. Import the shared module (it's a plain ESM file; the switcher already uses ESM imports).

### 7.6 One source of truth for models `[Opus — confirmed]`
Three disagreeing sources today: registry embedded defaults (`provider-registry.js`), per-provider `getModels()` methods (**dead code — never called**, but their hardcoded lists look authoritative), and `model-refresh.js` fetchers (whose `fetchAnthropicModels()` duplicates the registry's Anthropic list a third time — and note Anthropic *does* have a `/v1/models` API now; the "no public API" comment at `model-refresh.js:168` is stale). Plan: delete every provider `getModels()` (and the base-class contract for it, `llm-service.js:51-53`), make `model-refresh` fetch Anthropic models from the API, and treat registry (defaults ∪ lastFetched) as the only source. Update `llm-factory.test.js`/provider tests that reference `getModels`.

### 7.7 Listener lifecycle `[Opus — partially corrected]`
- Preload exposes `on*` subscriptions with no `removeListener` counterparts (`preload.js:18-79`, `:173-175`). Today windows die with their listeners, so leaks are bounded — but `sendToWindows` broadcasts to all three windows, and the **model-switcher** subscribes to nothing while homepage subscribes to `update-status`, `config-changed`, `session-deleted`, `new-chat`, `context-menu-command`. Correction to Opus: the dashboard **is destroyed** on close (`window-ipc.js:53-58`), so "state persists across open/close" is wrong — but each reopen re-runs `init()` fresh, which re-fetches everything (that's the actual cost: startup work per open, incl. a forced model refresh at `homepage.js:1846-1850` → network call each time the dashboard opens). Return unsubscribe functions from the preload `on*` helpers as part of §7.1/7.2 hygiene; gate the dashboard's forced startup refresh behind the 2-minute cooldown that already exists (`lastModelRefreshAt`).
- Dead export check: `clearScreenshotChip()` is imported and called by `app.js` but there's no code that ever *creates* `#screenshot-chip` — the "Show screenshot chip preview" block is an empty comment (`app.js:836-838`). Either implement the chip (vault has "Screenshot Preview Thumbnail" as a planned feature) or delete the vestige.

---

## 8. Build, packaging, docs

### 8.1 Vendor libraries as ESM imports `[Opus]` — **MED**
- **Where:** `index.html:20-27` — `marked`, `dompurify`, `katex` (+auto-render), `@highlightjs/cdn-assets` loaded via `<script src="../../node_modules/...">`.
- **Status/correction (Opus verified, worth repeating):** this does **not** break in the packaged app — electron-builder ships prod `node_modules` inside `app.asar` and the relative path resolves. But it (a) ships entire packages instead of tree-shaken bundles, (b) depends on globals (`globalThis.marked` etc. — the reason §2.6's fail-open exists at all), (c) makes Vite emit `cannot find path for dependency name=undefined` warnings, and (d) couples the renderer to node_modules layout.
- **Fix:** `import { marked } from 'marked'`, `import DOMPurify from 'dompurify'`, `import katex from 'katex'` + `katex/dist/katex.min.css`, `highlight.js/lib/core` with explicit language registration (§4.4). Rewrite `rendering-adapter.js`'s `get*()` accessors to direct imports and make the DOMPurify path fail-closed in the same PR. Then remove the now-unneeded `files` entries and let electron-builder exclude renderer deps from the asar (that's the actual 59 MB → small win).

### 8.2 `shade-providers.json` at repo root is unused and stale `[Opus — confirmed]` — **LOW**
- Runtime reads/writes `<userData>/data/providers.json` (`provider-registry.js:146-178`); the repo-root file is never loaded and has drifted from the embedded defaults. Delete it (or move to `docs/examples/` with a README note if it's meant as documentation).

### 8.3 Stale docs & metadata `[Opus — confirmed]` — **LOW**
- `docs/TESTS_SETUP.md` still says **"GhostPad"** and claims "7 files / 300+ tests" (reality: 18 files / 303 tests) plus aspirational coverage numbers. Rewrite or delete — wrong docs are worse than none.
- README version badge hardcodes 0.14.0. Either drop the badge or use a dynamic one (`img.shields.io/github/package-json/v/...`).
- `package.json` `author` is empty and `description` says "Windows desktop overlay" — fine today, will need updating with the Linux plans; also `keywords` don't mention the app's actual function beyond "gemini".

### 8.4 Dead dependencies `[Opus — confirmed]` — **LOW**
- `devDependencies`: `typescript`, `@types/react`, `@types/react-dom`, `@types/node`, `@emnapi/core`, `@emnapi/runtime` — no TS, no React anywhere in the repo. Remove; verify `npm ci && vitest run && vite build` still green (the `@emnapi` pair sometimes rides in via sharp — confirm before deleting or just leave them out of `package.json` and let npm resolve transitively).

### 8.5 Release workflow gaps `[Fable]` — **LOW**
- `release.yml` builds with `--publish never` then uploads `dist/*.exe`, `*.blockmap`, `latest.yml` to a **draft** release — good. Missing: the signing step (§2.1) and any smoke check that the packaged app launches (even `xvfb`-less `--version` on the unpacked build catches broken asar packaging). CI (`ci.yml`) runs tests on Windows only — fine for now, revisit with the Linux port.

---

## 9. Suggested execution order

Highest ROI first, sized for review-friendly PRs:

1. **Kick off code-signing cert procurement** (§2.1) — calendar time, zero code.
2. **Dead default model IDs + selected-model heal** (§3.2) — tiny diff, fixes first-run.
3. **Streaming/abort cluster** (§3.1 a–d: requestId gating, controller ownership, abort on new-chat/resume, Gemini cancel) + chat-ipc tests (§6.4).
4. **Trust pass:** Delete-Everything actually deletes (§2.2), single-delete confirm (§3.9), silent-failure result checks (§3.8).
5. **Shortcut scoping** (§3.4) — stop hijacking Ctrl+R/M system-wide.
6. **Config-service hardening:** deep-clone defaults (§3.3), `enc:v1:` marker + decrypt-failure UX (§2.4), plaintext warning (§2.3), strip `apiKey` from IPC (§2.5) + the §6.1 tests.
7. **Renderer safety & vendoring:** fail-closed sanitizer (§2.6) + ESM imports + highlight.js slimming (§8.1, §4.4) — one PR, they interlock.
8. **Mode-override single-writer** (§3.5) + model-switcher browse/commit fix (§3.7).
9. **Streaming render throttle** (§4.1) + `max_tokens` bump (§4.2).
10. **Docs/deps cleanup sweep** (§5.2, §8.2–8.4).
11. **Reconcile `bugfix` + `multi_monitor` branches**, then the **refactor program** (§7.1–7.7) in order: CSS extraction → app.js split → homepage.js split → config-service split → model source-of-truth.
12. Then the roadmap features (vault: web search, Tier-1 providers, AnthropicProvider `baseUrl`; plus the new-feature list discussed separately).

---

*Feature proposals are intentionally excluded from this document — see the roadmap in the Obsidian vault (`Shade.md`) and the 2026-07-02 feature discussion (screenshot follow-up context, rolling re-summarization, retry/fallback chain, command palette, ask-about-selection, session export, token/cost meter, prompt-injection hardening).*

---

## 10. Fix log

Tracks completed items against the audit findings. Branch: `fixes`.

### 2026-07-02

#### ✅ §3.3 Config defaults are mutated through shared references — FIXED
- **Commit:** `ab72247 fix(config): deep-clone default config to prevent factory-default mutation`
- **Files:** `src/services/config-service.js`, `src/services/__tests__/config-service.test.js`
- **What was done:** Applied `JSON.parse(JSON.stringify(...))` at all 16 mutable-default hand-off sites: the `loadConfig()` merge block (new `const base = ...` covering providers/modes/autoUpdate), the `loadConfig()` error fallback, `clearAll()`, `getModes()` (×2), `getDefaultModes()` return, and all setter seed sites for `memorySettings` (×3), `sessionSettings` (×3), `autoUpdate` (×2, confirmed object not primitive), and `overlaySettings` (×2). Primitive `activeMode` string assignments left untouched. The `loadConfig()` merge fix additionally closes a second shared-ref leak where providers and autoUpdate became shared with `defaultConfig` when an on-disk config omitted those keys.
- **Tests added (3):** mode integrity (`saveMode` no longer corrupts `getDefaultModes()`), settings isolation (`setHistoryLimit` no longer mutates `defaultConfig.memorySettings`), merge-path isolation (`setAutoUpdateEnabled` on a partial on-disk config no longer mutates `defaultConfig.autoUpdate`). All three were confirmed RED on pre-fix code and GREEN after.
- **Suite after:** 291 pass / 15 skip (was 288).
- **Note:** The audit described ~8 sites; full enumeration found 16, including the `loadConfig()` merge path not mentioned in the original finding. The §7.4 refactor (splitting `config-service.js`) becomes simpler now that defaults are reliably cloned.

#### ✅ §2.6 Markdown sanitizer fails open — FIXED
- **Commit:** `8ef6d80 fix(renderer): fail closed to escaped text when DOMPurify or marked is unavailable`
- **Files:** `src/renderer/utils/rendering-adapter.js`, `src/renderer/utils/__tests__/rendering-adapter.test.js`
- **What was done:** Added `import { escapeHtml } from './html-escape.js'` at the top of `rendering-adapter.js`. Changed all three unsafe return paths in `renderMarkdownSafe()` to return `escapeHtml(input)` (the original raw text, not the partially-processed HTML): (1) `if (!markedLib)` branch, (2) `if (!purifier)` branch — this was the primary audit concern, (3) `catch` block. The happy path (both marked and DOMPurify present) is untouched. Intentional trade-off: when the sanitizer is absent, markdown/LaTeX formatting is sacrificed for safety.
- **Tests added (3):** DOMPurify absent → escaped output, marked absent → escaped output, `marked.parse` throws → escaped output. All three use the existing `await loadAdapter()` harness pattern for proper module isolation and were confirmed RED on pre-fix code and GREEN after. Existing 8 LaTeX tests unchanged.
- **Suite after:** 294 pass / 15 skip (was 291 after §3.3 fix; cumulative +6 new tests from both fixes).
- **Note:** The §8.1 ESM vendoring work (replacing `globalThis.*` globals with direct imports) will make these fallback paths unreachable in practice, but the fail-closed behavior stays as defense-in-depth.

---

### Still open (pending live-key session or laptop)

- **§3.2** Dead default model IDs + selection-heal — deferred. User principle: models must always come from the API, never a hardcoded static list. Full fix folds §3.2 + §7.6 into one "models-from-API" plan: retire `gemini-2.0-flash-exp` and `grok-vision-beta` defaults, add a heal step (reconcile stored selection against live-fetched list, toast on change), collapse static `models: {}` lists to a minimal bootstrap seed. Needs live API key for smoke-test.
- **Everything else in §§2–9** — not yet started.
