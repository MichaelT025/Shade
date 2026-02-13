/**
 * Shade Chat UI
 * Handles message display, screenshot capture, and user interactions
 */

import { getIcon, insertIcon, initIcons } from './assets/icons/icons.js';
import { showToast, copyToClipboard } from './utils/ui-helpers.js';
import MemoryManager from './utils/memory-manager.js';
import { renderMarkdownSafe } from './utils/rendering-adapter.js';
import {
  generateMessageId,
  safePathPart,
  buildSessionPayload,
  prunePersistedScreenshotBase64,
  normalizeSessionMessages
} from './utils/session-client.js';
import { setupScreenshotPreview, clearScreenshotChip } from './utils/screenshot-ui.js';

// State management
const messages = [] // Chat history array (for UI display)
let currentSessionId = null
let memoryManager = null // Memory manager instance (for context optimization)
let capturedScreenshot = null // Current screenshot base64
let capturedThumbnail = null // Screenshot thumbnail for preview
let isScreenshotActive = false // Screenshot button state
let isGenerating = false // Whether LLM is currently generating
let currentStreamingMessageId = null // ID of currently streaming message
let currentLoadingId = null // ID of current loading indicator
let accumulatedText = '' // Accumulated text during streaming
let isCollapsed = true // Overlay collapse state (starts collapsed)
let lastShownErrorSignature = ''
let lastShownErrorAt = 0

// Behavior settings (from Configuration)
let screenshotMode = 'manual' // 'manual' | 'auto'
let excludeScreenshotsFromMemory = true
let autoTitleSessions = true
  let sessionAutoTitleApplied = false

let startCollapsedSetting = true

// Predictive screenshot cache metadata (actual image data is cached in main process)
let predictiveScreenshot = null // Whether a predictive screenshot is cached in main process
let predictiveScreenshotTimestamp = null // When the screenshot was captured
let predictiveCaptureInProgress = false // Whether a predictive capture is currently running
let predictiveCapturePromise = null // Awaitable promise for in-flight capture
let predictiveCaptureTimer = null
let inputWasEmpty = true
let revealEffectsTimer = null
const PREDICTIVE_SCREENSHOT_MAX_AGE = 15000 // 15 seconds - max age for cached screenshot
const PREDICTIVE_CAPTURE_IDLE_DELAY = 1500 // 1.5s — must exceed natural typing pauses (300-800ms)

// Cached asset paths (resolved at startup to work in packaged app)
let appLogoSrc = '../../build/appicon.png' // Will be resolved from DOM

// DOM element references
const messagesContainer = document.getElementById('messages-container')
let chatWrapper = document.getElementById('chat-wrapper') // Use let for reassignment after new chat
const messageInput = document.getElementById('message-input')
const inputContainer = document.querySelector('.input-container')
const sendBtn = document.getElementById('send-btn')
const screenshotBtn = document.getElementById('screenshot-btn')
const homeBtn = document.getElementById('home-btn')
const closeBtn = document.getElementById('close-btn')
const hideBtn = document.getElementById('hide-btn')
const collapseBtn = document.getElementById('collapse-btn')
const updateReadyBtn = document.getElementById('update-ready-btn')
const modeDropdownInput = document.getElementById('mode-dropdown-input')
const newChatBtn = document.getElementById('new-chat-btn')
const scrollBottomBtn = document.getElementById('scroll-bottom-btn')

let isUpdateReady = false

function setUpdateReadyIndicator(ready) {
  isUpdateReady = !!ready
  if (!updateReadyBtn) return
  updateReadyBtn.style.display = isUpdateReady ? 'inline-flex' : 'none'
}

async function restartAndInstallUpdate() {
  try {
    const result = await window.electronAPI.quitAndInstallUpdate?.()
    if (!result?.success) {
      showToast(result?.error || 'Failed to start update install.', 'error', 3000)
    }
  } catch (error) {
    showToast(error?.message || 'Failed to start update install.', 'error', 3000)
  }
}

// Session persistence
let sessionSaveTimer = null

function scheduleSessionSave() {
  if (sessionSaveTimer) {
    clearTimeout(sessionSaveTimer)
  }

  sessionSaveTimer = setTimeout(() => {
    saveCurrentSession().catch(error => {
      console.error('Failed to autosave session:', error)
    })
    sessionSaveTimer = null
  }, 350)
}

async function saveCurrentSession() {
  if (!window.electronAPI?.saveSession) {
    return
  }


  // Do not create persisted sessions with no messages.
  // This prevents empty "New Chat" entries from being saved.
  if (!Array.isArray(messages) || messages.length === 0) {
    return
  }
  const activeProviderResult = await window.electronAPI.getActiveProvider()

  const provider = activeProviderResult?.success ? activeProviderResult.provider : ''

  let model = ''
  if (provider) {
    const providerConfigResult = await window.electronAPI.getProviderConfig(provider)
    model = providerConfigResult?.success ? (providerConfigResult.config?.model || '') : ''
  }

  const sessionPayload = buildSessionPayload({
    currentSessionId,
    provider,
    mode: modeDropdownInput?.value || '',
    model,
    messages
  })

  const result = await window.electronAPI.saveSession(sessionPayload)
  if (result?.success && result.session?.id) {
    currentSessionId = result.session.id
  }

  // Once a screenshot message is persisted, keep only the on-disk reference.
  if (result?.success) {
    prunePersistedScreenshotBase64(messages)
  }
}

async function loadSessionIntoChat(sessionId) {
  if (!sessionId) return

  const result = await window.electronAPI.loadSession(sessionId)
  if (!result?.success) {
    console.error('Failed to load session:', result?.error)
    showToast('Failed to load session', 'error', 2500)
    return
  }

  const session = result.session
  if (!session || !Array.isArray(session.messages)) {
    showToast('Session data was invalid', 'error', 2500)
    return
  }

  // Clear any previously attached screenshot to prevent leakage between sessions.
  removeScreenshot()

  // Reset UI container
  messagesContainer.innerHTML = '<div class="chat-wrapper" id="chat-wrapper"></div>'
  chatWrapper = document.getElementById('chat-wrapper')

  // Reset state
  messages.length = 0
  currentSessionId = session.id || sessionId
  sessionAutoTitleApplied = true

  if (memoryManager) {
    memoryManager.clearConversation()
  }

  // Render all messages without re-saving during hydration
  const hydratedMessages = normalizeSessionMessages(session.messages)
  for (const m of hydratedMessages) {
    const type = m.type
    const text = m.text
    const hasScreenshot = m.hasScreenshot
    const timestamp = m.timestamp

    const messageEl = document.createElement('div')
    messageEl.className = `message ${type}`

    if (type === 'ai') {
      messageEl.innerHTML = renderMarkdown(text)
      addCopyButtons(messageEl)
      addMessageCopyButton(messageEl, text)
    } else {
      messageEl.textContent = text
    }

    chatWrapper.appendChild(messageEl)

    if (hasScreenshot && type === 'user') {
      const meta = document.createElement('div')
      meta.className = 'message-meta'
      meta.textContent = 'Sent with screenshot'
      
      // Setup hover preview
      setupScreenshotPreview(meta, () => ({
        sessionId: currentSessionId || session.id,
        screenshotPath: m.screenshotPath,
        base64: m.screenshotBase64
      }), window.electronAPI.getScreenshot)

      chatWrapper.appendChild(meta)
    }

    messages.push({
      id: m.id,
      type,
      text,
      hasScreenshot,
      ...(typeof m.screenshotPath === 'string' && m.screenshotPath ? { screenshotPath: m.screenshotPath } : {}),
      timestamp
    })

    if (memoryManager) {
      const role = type === 'user' ? 'user' : 'assistant'
      memoryManager.addMessage(role, text)
    }
  }

  // Restore the last screenshot for this session (only if we keep screenshots in memory).
  if (screenshotMode === 'manual' && !excludeScreenshotsFromMemory) {
    const lastScreenshotBase64 = typeof session.lastScreenshotBase64 === 'string'
      ? session.lastScreenshotBase64
      : ''

    if (lastScreenshotBase64) {
      capturedScreenshot = lastScreenshotBase64
      capturedThumbnail = lastScreenshotBase64
      isScreenshotActive = true
      screenshotBtn.classList.add('active')
      screenshotBtn.title = 'Remove screenshot'
      messageInput.placeholder = 'Ask about the captured screen...'
    }
  }

  // Ensure the overlay is usable when resuming
  expand()
  scrollToBottom()
}

function autosizeMessageInput() {
  const maxHeight = 140

  // Reset to measure scrollHeight correctly
  messageInput.style.height = 'auto'
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, maxHeight)}px`

  // In collapsed mode the BrowserWindow must follow input growth,
  // otherwise the lower controls get clipped.
  scheduleCollapsedHeightSync()
}

function measureCollapsedHeight() {
  const root = document.querySelector('#root')
  const titleBar = document.querySelector('.title-bar')
  const inputArea = document.querySelector('.input-area')

  if (!titleBar || !inputArea) return 146

  // Force layout calculation
  const titleRect = titleBar.getBoundingClientRect()
  const inputRect = inputArea.getBoundingClientRect()

  const contentHeight = Math.ceil(titleRect.height + inputRect.height)

  // Account for #root borders (1px top + 1px bottom) + safety buffer
  // Buffer prevents sub-pixel rounding from clipping the input box.
  return contentHeight + 8
}

/**
 * Load behavior settings from Configuration
 */
async function loadBehaviorSettings() {
  try {
    const [screenshotModeResult, excludeResult, sessionSettingsResult, startCollapsedResult] = await Promise.all([
      window.electronAPI.getScreenshotMode?.(),
      window.electronAPI.getExcludeScreenshotsFromMemory?.(),
      window.electronAPI.getSessionSettings?.(),
      window.electronAPI.getStartCollapsed?.()
    ])

    screenshotMode = screenshotModeResult?.success ? (screenshotModeResult.mode === 'auto' ? 'auto' : 'manual') : 'manual'
    excludeScreenshotsFromMemory = excludeResult?.success ? excludeResult.exclude !== false : true
    autoTitleSessions = sessionSettingsResult?.success ? sessionSettingsResult.settings?.autoTitleSessions !== false : true
    startCollapsedSetting = startCollapsedResult?.success ? startCollapsedResult.startCollapsed !== false : true

    // In auto mode, keep the image icon "toggled on" and make it informational.
    const isAuto = screenshotMode === 'auto'

    if (screenshotBtn) {
      screenshotBtn.disabled = isAuto
      screenshotBtn.title = isAuto ? 'Auto screenshot mode is enabled' : 'Capture Screenshot'

      if (isAuto) {
        screenshotBtn.classList.add('active')
        screenshotBtn.classList.add('show-label')
        isScreenshotActive = true

        const label = document.getElementById('screenshot-label')
        if (label) label.textContent = 'Using screen'
      } else {
        screenshotBtn.classList.remove('show-label')
        const label = document.getElementById('screenshot-label')
        if (label) label.textContent = ''
      }
    }
  } catch (error) {
    console.error('Failed to load behavior settings:', error)
  }
}

async function maybeAutoTitleSessionFromFirstReply(replyText) {
  if (!autoTitleSessions) return
  if (sessionAutoTitleApplied) return

  const normalized = typeof replyText === 'string' ? replyText.trim() : ''
  if (!normalized) return

  // Only auto-title after the first assistant reply in a new session
  const aiCount = messages.filter(m => m.type === 'ai').length
  if (aiCount !== 1) return

  try {
    // Ensure session is persisted and has an id
    await saveCurrentSession()
    if (!currentSessionId) return

    const titleResult = await window.electronAPI.generateSessionTitle(normalized)
    if (!titleResult?.success || !titleResult.title) return

    await window.electronAPI.renameSession(currentSessionId, titleResult.title)
    sessionAutoTitleApplied = true
  } catch (error) {
    console.error('Failed to auto-title session:', error)
  }
}

/**
 * Initialize the application
 */
async function init() {
  setVisualEffectsEnabled(false, 0, 'init-start')

  // Capture the working logo path from the existing DOM element
  // This ensures the path works in both dev and packaged builds
  const existingLogo = document.querySelector('#home-btn .app-icon')
  if (existingLogo && existingLogo.src) {
    appLogoSrc = existingLogo.src
  }

  // Initialize memory manager with history limit from settings
  const historyLimitResult = await window.electronAPI.getHistoryLimit()
  const historyLimit = historyLimitResult.success ? historyLimitResult.limit : 10
  memoryManager = new MemoryManager(historyLimit)
  console.log('MemoryManager initialized with limit:', historyLimit)

  await loadBehaviorSettings()

  // Setup preview for screenshot button
  setupScreenshotPreview(screenshotBtn, () => {
    if (!isScreenshotActive || !capturedScreenshot) return null
    return { base64: capturedScreenshot }
  }, window.electronAPI.getScreenshot)

  // Screenshot button - toggle screenshot attachment in manual mode
  screenshotBtn.addEventListener('click', async () => {
    if (screenshotMode === 'auto') {
      showToast('Auto screenshot mode is enabled', 'info', 2000)
      return
    }

    if (isScreenshotActive) {
      removeScreenshot()
      return
    }

    await handleScreenshotCapture()
  })

  // Send button - send message with optional screenshot
  sendBtn.addEventListener('click', handleSendMessage)

  // Scroll to bottom button
  scrollBottomBtn.addEventListener('click', () => {
    scrollToBottom()
  })

  // Collapse toggle button
  collapseBtn.addEventListener('click', toggleCollapse)

  messageInput.addEventListener('input', autosizeMessageInput)
  autosizeMessageInput()

  // Enter to send message, Shift+Enter for newline
  messageInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()

      // Ctrl+Enter: Quick send with screenshot (capture if needed)
      if (e.ctrlKey) {
        // Always capture a fresh screenshot for Ctrl+Enter "Assist" if we don't have one.
        // In auto mode, isScreenshotActive is true but capturedScreenshot may be null.
        if (!capturedScreenshot) {
          await handleScreenshotCapture()
        }
        sendBtn.click()
      } else {
        sendBtn.click()
      }
    }
  })

  // Home button - go to homepage/dashboard
  homeBtn.addEventListener('click', async () => {
    try {
      await saveCurrentSession()
    } catch (error) {
      console.error('Failed to save session before navigating:', error)
    }

    window.electronAPI.openSettings()
  })

  // Close button - quit application
  closeBtn.addEventListener('click', () => {
    window.electronAPI.quitApp()
  })

  // Hide button - hide application
  hideBtn.addEventListener('click', () => {
    window.electronAPI.hideWindow()
  })

  updateReadyBtn?.addEventListener('click', async () => {
    const confirmed = window.confirm('Update is ready. Restart Shade now to apply it?')
    if (!confirmed) return
    await restartAndInstallUpdate()
  })


  // Mode dropdown - switch active mode
  modeDropdownInput.addEventListener('change', handleModeSwitch)


  // New Chat button
  newChatBtn.addEventListener('click', handleNewChat)

  // Ctrl+R new chat handler
  window.electronAPI.onNewChat(handleNewChat)

  // If the current session is deleted from the dashboard, reset the overlay.
  window.electronAPI.onSessionDeleted?.((sessionId) => {
    if (!sessionId || currentSessionId === sessionId) {
      handleNewChat()
    }
  })
 
  // Config changed handler (from settings window)
  window.electronAPI.onConfigChanged(async () => {
    console.log('Config changed, refreshing modes...')
    await loadModes()

    // Update memory manager with new history limit
    const historyLimitResult = await window.electronAPI.getHistoryLimit()
    if (historyLimitResult.success && memoryManager) {
      memoryManager.updateHistoryLimit(historyLimitResult.limit)
    }

    await loadBehaviorSettings()
  })

  // Streaming event handlers
  window.electronAPI.onMessageChunk(handleMessageChunk)
  window.electronAPI.onMessageComplete(handleMessageComplete)
  window.electronAPI.onMessageError(handleMessageError)

  // Collapse toggle event handler (Ctrl+')
  window.electronAPI.onToggleCollapse(toggleCollapse)

  // Screenshot capture hotkey (Ctrl+Shift+S)
  window.electronAPI.onCaptureScreenshot(handleScreenshotCapture)

  window.electronAPI.onUpdateStatus?.((status) => {
    const ready = status?.status === 'downloaded' || status?.updateReady === true
    setUpdateReadyIndicator(ready)
  })

  try {
    const updateStatus = await window.electronAPI.getUpdateStatus?.()
    const ready = updateStatus?.status === 'downloaded' || updateStatus?.updateReady === true
    setUpdateReadyIndicator(ready)
  } catch {
    setUpdateReadyIndicator(false)
  }

  // Listen for active mode changes from dashboard
  window.electronAPI.onActiveModeChanged(async (modeId) => {
    console.log('Active mode changed in dashboard, updating overlay...', modeId)
    // Refresh modes to make sure we have any new ones, then select the new active one
    await loadModes()
    modeDropdownInput.value = modeId
  })

  // Initialize custom icons from directory
  await initIcons()


    // Insert icons into UI elements
    insertIcon(closeBtn, 'power', 'icon-svg')
    insertIcon(hideBtn, 'eye-off', 'icon-svg')
    insertIcon(newChatBtn, 'newchat', 'icon-svg')
    if (updateReadyBtn) insertIcon(updateReadyBtn, 'download', 'icon-svg')

   const screenshotIcon = document.getElementById('screenshot-icon')
   if (screenshotIcon) {
     insertIcon(screenshotIcon, 'camera', 'icon-svg')
   } else {
     insertIcon(screenshotBtn, 'camera', 'icon-svg')
   }

   insertIcon(sendBtn, 'send', 'icon-svg')
   insertIcon(scrollBottomBtn, 'arrow-down', 'icon-svg')

  // Load modes and populate dropdown
  await loadModes()

  // Set up scroll gradient detection
  messagesContainer.addEventListener('scroll', updateScrollGradients)
  updateScrollGradients() // Initial check

  // Auto-focus the input field so keyboard shortcuts work immediately
  messageInput.focus()

  // Initialize collapsed state from settings.
  // Compute the desired height BEFORE signaling ready so the main process
  // can size the window correctly before showing it.
  isCollapsed = !!startCollapsedSetting

  // Tell the main process we're ready, with our desired initial size.
  // The main process will apply the collapsed bounds (if needed) and then
  // call show() — this prevents the user from seeing a mis-sized window.
  if (isCollapsed) {
    // Apply collapsed CSS class so measureCollapsedHeight() reads the right layout.
    const overlay = document.querySelector('#root')
    overlay.classList.add('overlay-collapsed')
    insertIcon(collapseBtn, 'expand', 'icon-svg')
    collapseBtn.title = 'Expand (Ctrl+\')'
    autosizeMessageInput()

    const collapsedHeight = measureCollapsedHeight()
    overlay.style.height = `${collapsedHeight}px`
    lastCollapsedHeight = collapsedHeight

    window.electronAPI.rendererReady({ collapsed: true, height: collapsedHeight })
  } else {
    insertIcon(collapseBtn, 'collapse', 'icon-svg')
    collapseBtn.title = 'Collapse (Ctrl+\')'

    window.electronAPI.rendererReady({ collapsed: false })
  }

  window.electronAPI.onResumeSession((sessionId) => {
    loadSessionIntoChat(sessionId).catch(error => {
      console.error('Failed to resume session:', error)
    })
  })

  window.electronAPI.onWindowHidden?.(() => {
    console.log('[Shade visibility][renderer] window-hidden', {
      at: Date.now()
    })

    // Disable effects before hide to ensure clean state on next show
    setVisualEffectsEnabled(false, 0, 'window-hidden')
    document.body.classList.add('reveal-settling')
  })

  window.electronAPI.onWindowShown?.(() => {
    console.log('[Shade visibility][renderer] window-shown', {
      at: Date.now(),
      hidden: document.hidden
    })

    // Force CSS recalc to clear any stale compositor state from hide
    const root = document.getElementById('root')
    if (root) {
      root.style.display = 'none'
      root.offsetHeight // Force reflow
      root.style.display = ''
    }

    // Apply reveal-settling class to suppress first-frame transitions
    document.body.classList.add('reveal-settling')

    // Enable effects immediately to prevent backdrop-filter flash
    setVisualEffectsEnabled(true, 0, 'window-shown')

    // Clear the settling class after short delay (after window is stable)
    setTimeout(() => {
      document.body.classList.remove('reveal-settling')
    }, 120)
  })

  // Input typing handler:
  // - capture on typing idle (not every keystroke)
  // - refresh only when cache has expired
  messageInput.addEventListener('input', () => {
    const isEmpty = messageInput.value.trim().length === 0

    if (screenshotMode === 'auto' && !isEmpty && !predictiveCaptureInProgress) {
      if (inputWasEmpty) {
        schedulePredictiveCapture({ forceFresh: false, delay: PREDICTIVE_CAPTURE_IDLE_DELAY })
      } else if (!isPredictiveScreenshotFresh()) {
        schedulePredictiveCapture({ forceFresh: false, delay: PREDICTIVE_CAPTURE_IDLE_DELAY })
      }
    }

    inputWasEmpty = isEmpty
  })

  // Visibility change handler (clear stale screenshots when window is hidden)
  document.addEventListener('visibilitychange', () => {
    console.log('[Shade visibility][renderer] visibilitychange', {
      at: Date.now(),
      hidden: document.hidden
    })

    if (document.hidden) {
      // Window is being hidden - clear predictive screenshot and cancel pending capture
      clearPredictiveScreenshot()
      if (predictiveCaptureTimer) {
        clearTimeout(predictiveCaptureTimer)
        predictiveCaptureTimer = null
      }
      // Disable effects on hide to ensure clean state on next show
      setVisualEffectsEnabled(false, 0, 'visibility-hidden')
      document.body.classList.add('reveal-settling')
    } else {
      // Avoid duplicate reveal races: unhide visual effects are handled by
      // the explicit `window-shown` IPC emitted by the main process.
      console.log('[Shade visibility][renderer] visible; waiting for window-shown to re-enable effects')
    }
  })

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setVisualEffectsEnabled(true, 120, 'init-raf')
      // Remove reveal-settling after init so normal animations work
      document.body.classList.remove('reveal-settling')
    })
  })

  console.log('Shade initialized')
}

/**
 * Check if user is scrolled near the bottom of the messages container
 * @returns {boolean} - True if within 50px of bottom
 */
function isScrolledNearBottom() {
  const container = messagesContainer
  const distFromBottom = container.scrollHeight - container.clientHeight - container.scrollTop
  return distFromBottom < 50
}

/**
 * Update scroll gradient indicators and scroll-to-bottom button
 */
function updateScrollGradients() {
  const container = messagesContainer
  const hasScrollTop = container.scrollTop > 20

  // Show scroll-to-bottom button if we're not near the bottom
  const hasScrollBottom = !isScrolledNearBottom()

  container.classList.toggle('has-scroll-top', hasScrollTop)
  container.classList.toggle('has-scroll-bottom', hasScrollBottom)

  // Toggle scroll button visibility
  if (scrollBottomBtn) {
    if (hasScrollBottom) {
      scrollBottomBtn.classList.add('visible')
    } else {
      scrollBottomBtn.classList.remove('visible')
    }
  }
}

/**
 * Scroll to bottom and update gradients
 */
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight
  // Update gradients after scroll completes
  setTimeout(() => updateScrollGradients(), 50)
}

/**
 * Collapse state management
 */

/**
 * Toggle collapse state
 */
function toggleCollapse() {
  isCollapsed = !isCollapsed
  updateCollapseState()
}

/**
 * Expand the overlay
 */
function expand() {
  isCollapsed = false
  updateCollapseState()
}

/**
 * Collapse the overlay
 */
function collapse() {
  isCollapsed = true
  updateCollapseState()
}

/**
 * Update the visual collapse state
 */
let collapseResizeTimer = null
let collapsedHeightSyncRaf = null
let lastCollapsedHeight = 0

function scheduleCollapsedHeightSync() {
  if (!isCollapsed) return

  if (collapsedHeightSyncRaf) {
    cancelAnimationFrame(collapsedHeightSyncRaf)
  }

  collapsedHeightSyncRaf = requestAnimationFrame(() => {
    collapsedHeightSyncRaf = null
    if (!isCollapsed) return

    const overlay = document.querySelector('#root')
    if (!overlay) return

    const collapsedHeight = measureCollapsedHeight()
    overlay.style.height = `${collapsedHeight}px`

    if (collapsedHeight !== lastCollapsedHeight) {
      lastCollapsedHeight = collapsedHeight
      window.electronAPI.setCollapsed(true, collapsedHeight)
    }
  })
}

function updateCollapseState() {
  const overlay = document.querySelector('#root')

  // Cancel any pending resize from previous toggles
  if (collapseResizeTimer) {
    clearTimeout(collapseResizeTimer)
    collapseResizeTimer = null
  }

  collapseBtn.title = 'Toggle Collapse (Ctrl+\')'
  collapseBtn.setAttribute('aria-label', 'Toggle collapse')

  const transitionMs = 220

  if (isCollapsed) {
    // Apply collapsed styles first so measurements are accurate
    overlay.classList.add('overlay-collapsed')
    insertIcon(collapseBtn, 'expand', 'icon-svg')
    collapseBtn.title = 'Expand (Ctrl+\')'
    autosizeMessageInput()

    requestAnimationFrame(() => {
      if (!isCollapsed) return

      const collapsedHeight = measureCollapsedHeight()
      overlay.style.height = `${collapsedHeight}px`

      // Animate content collapse first, then shrink the window so it doesn't block the screen
      collapseResizeTimer = setTimeout(() => {
        lastCollapsedHeight = collapsedHeight
        window.electronAPI.setCollapsed(true, collapsedHeight)
        collapseResizeTimer = null
      }, transitionMs)
    })
  } else {
    // Expand window first, then animate content in
    window.electronAPI.setCollapsed(false)
    insertIcon(collapseBtn, 'collapse', 'icon-svg')
    collapseBtn.title = 'Collapse (Ctrl+\')'

    requestAnimationFrame(() => {
      if (isCollapsed) return

      overlay.style.height = '100vh'
      overlay.classList.remove('overlay-collapsed')
      lastCollapsedHeight = 0
      autosizeMessageInput()
    })
  }
}

/**
 * Handle screenshot capture
 */
async function handleScreenshotCapture() {
  try {
    console.log('Capturing screenshot...')
    const result = await window.electronAPI.captureScreen({ captureMode: 'manual' })

    if (result.success) {
      capturedScreenshot = result.base64
      capturedThumbnail = result.thumbnail || result.base64 // Use thumbnail if available
      screenshotBtn.classList.add('active')
      isScreenshotActive = true
      screenshotBtn.title = 'Remove screenshot'
      
      // Clear any predictive screenshot since we now have a manual one
      clearPredictiveScreenshot()
      
      // Show screenshot chip preview
      
      // Update input placeholder
      messageInput.placeholder = 'Ask about the captured screen...'
      
      console.log('Screenshot captured and attached')
    } else {
      console.error('Screenshot capture failed:', result.error)
      showToast('Failed to capture screenshot: ' + result.error, 'error')
    }
  } catch (error) {
    console.error('Screenshot error:', error)
    showToast('Screenshot error: ' + error.message, 'error')
  }
}

/**
 * Show screenshot chip preview
 */
/**
 * Perform predictive screenshot capture in the background
 * This captures a screenshot before the user hits send to reduce perceived delay
 */
function schedulePredictiveCapture({ forceFresh = false, delay = 0 } = {}) {
  if (predictiveCaptureTimer) {
    clearTimeout(predictiveCaptureTimer)
    predictiveCaptureTimer = null
  }

  // Do not schedule predictive capture when hidden
  if (document.hidden) {
    return
  }

  predictiveCaptureTimer = setTimeout(() => {
    predictiveCaptureTimer = null
    predictiveCapturePromise = performPredictiveCapture(forceFresh)
    predictiveCapturePromise.finally(() => { predictiveCapturePromise = null })
  }, Math.max(0, delay))
}

function setVisualEffectsEnabled(enabled, delay = 0, reason = 'unspecified') {
  if (revealEffectsTimer) {
    clearTimeout(revealEffectsTimer)
    revealEffectsTimer = null
  }

  const apply = () => {
    const body = document.body
    if (!body) return

    if (enabled) {
      if (!document.hidden) {
        body.classList.add('effects-enabled')
      }
      console.log('[Shade visibility][renderer] effects-enabled', {
        at: Date.now(),
        enabled: true,
        reason,
        hidden: document.hidden
      })
      return
    }

    body.classList.remove('effects-enabled')
    console.log('[Shade visibility][renderer] effects-enabled', {
      at: Date.now(),
      enabled: false,
      reason,
      hidden: document.hidden
    })
  }

  if (delay > 0) {
    console.log('[Shade visibility][renderer] schedule-effects-toggle', {
      at: Date.now(),
      enabled,
      delay,
      reason,
      hidden: document.hidden
    })

    revealEffectsTimer = setTimeout(() => {
      revealEffectsTimer = null
      apply()
    }, delay)
    return
  }

  apply()
}

async function performPredictiveCapture(forceFresh = false) {
  // Only capture in auto mode and if not already in progress
  if (screenshotMode !== 'auto' || predictiveCaptureInProgress) {
    return
  }

  // Don't capture if we already have a fresh cached screenshot
  if (!forceFresh && isPredictiveScreenshotFresh()) {
    return
  }

  // Don't capture if we have a manually captured screenshot
  if (capturedScreenshot) {
    return
  }

  // Don't capture when document is hidden
  if (document.hidden) {
    return
  }

  predictiveCaptureInProgress = true
  console.log('Starting predictive screenshot capture...')

  try {
    const result = await window.electronAPI.captureScreen({ captureMode: 'predictive' })

    // Prevent caching when document becomes hidden during capture
    if (document.hidden) {
      console.log('Predictive capture completed while hidden; discarding result')
      return
    }

    if (result.success) {
      predictiveScreenshot = true
      predictiveScreenshotTimestamp = typeof result.cachedAt === 'number' ? result.cachedAt : Date.now()
      console.log('Predictive screenshot captured successfully')
    } else {
      console.error('Predictive screenshot capture failed:', result.error)
    }
  } catch (error) {
    console.error('Predictive screenshot error:', error)
  } finally {
    predictiveCaptureInProgress = false
  }
}

/**
 * Check if the cached predictive screenshot is still fresh (within max age)
 */
function isPredictiveScreenshotFresh() {
  if (!predictiveScreenshot || !predictiveScreenshotTimestamp) {
    return false
  }

  const age = Date.now() - predictiveScreenshotTimestamp
  return age < PREDICTIVE_SCREENSHOT_MAX_AGE
}

/**
 * Clear the predictive screenshot cache
 */
function clearPredictiveScreenshot() {
  predictiveScreenshot = null
  predictiveScreenshotTimestamp = null
  window.electronAPI.clearPredictiveScreenshot?.().catch(() => {})
  console.log('Predictive screenshot cache cleared')
}

/**
 * Remove screenshot
 */
function removeScreenshot() {
  if (screenshotMode === 'auto') {
    // In auto mode, the icon stays "toggled on".
    capturedScreenshot = null
    capturedThumbnail = null
    isScreenshotActive = true
    screenshotBtn.classList.add('active')
    screenshotBtn.classList.add('show-label')
    const label = document.getElementById('screenshot-label')
    if (label) label.textContent = 'Using screen'
    messageInput.placeholder = 'Ask about your screen or conversation, or ↩ for Assist'
    return
  }

  capturedScreenshot = null
  capturedThumbnail = null
  isScreenshotActive = false
  
  // Clear predictive cache as well
  clearPredictiveScreenshot()
  
  // Remove chip
  clearScreenshotChip()
  
  // Reset button state
  screenshotBtn.classList.remove('active')
  screenshotBtn.title = 'Capture Screenshot'
  
  // Reset placeholder
  messageInput.placeholder = 'Ask about your screen or conversation, or ↩ for Assist'
  
  console.log('Screenshot removed')
}

function resetSendButton() {
  isGenerating = false
  inputContainer.classList.remove('generating')
  inputContainer.classList.remove('thinking')
  sendBtn.disabled = false
  sendBtn.title = 'Send'
  sendBtn.setAttribute('aria-label', 'Send message')
  insertIcon(sendBtn, 'send')
  messageInput.disabled = false
  messageInput.focus()
}

/**
 * Handle sending a message
 */
async function handleSendMessage() {
  // If already generating, stop it
  if (isGenerating) {
    try {
      await window.electronAPI.stopMessage()
      showInterruptedMessage()
    } catch (error) {
      showError('Failed to stop response: ' + error.message)
    } finally {
      resetSendButton()
    }
    return
  }

  // Auto-expand on first message
  expand()

  let text = messageInput.value.trim()

  // Empty input defaults to "Assist" (enables screenshot auto-capture and Ctrl+Enter)
  if (!text) {
    text = 'Assist'
  }

  let sendScreenshot = capturedScreenshot
  let sendHasScreenshot = isScreenshotActive

  // Auto mode: use cached predictive screenshot if fresh, otherwise capture fresh
  // Exception: if we already have a manually captured screenshot (from Ctrl+Enter), use it
  if (screenshotMode === 'auto' && !capturedScreenshot) {
    sendScreenshot = null
    sendHasScreenshot = false

    // Wait for in-flight predictive capture to finish (with timeout)
    if (predictiveCaptureInProgress && predictiveCapturePromise) {
      console.log('Predictive capture in progress, waiting...')
      await Promise.race([
        predictiveCapturePromise,
        new Promise(resolve => setTimeout(resolve, 3000))
      ])
      if (predictiveCaptureInProgress) {
        console.log('Predictive capture timed out, proceeding without it')
      }
    }

    // Check if we have a fresh predictive screenshot cached
    if (isPredictiveScreenshotFresh()) {
      try {
        const predictiveResult = await window.electronAPI.consumePredictiveScreenshot()
        if (predictiveResult?.success && predictiveResult.base64) {
          sendScreenshot = predictiveResult.base64
          sendHasScreenshot = true
          console.log('Using cached predictive screenshot (age:', Date.now() - predictiveScreenshotTimestamp, 'ms)')
        }
      } catch (error) {
        console.error('Failed to consume predictive screenshot:', error)
      }
    }

    if (!sendScreenshot && text) {
      // No fresh cached screenshot - capture now (this will block sending)
      try {
        const captureResult = await window.electronAPI.captureScreen({ captureMode: 'send' })
        if (captureResult?.success) {
          sendScreenshot = captureResult.base64
          sendHasScreenshot = true
        } else {
          showToast('Failed to capture screenshot: ' + (captureResult?.error || 'Unknown error'), 'error', 3000)
        }
      } catch (error) {
        showToast('Failed to capture screenshot: ' + error.message, 'error', 3000)
      }
    }

  }

  // Don't send if both text and screenshot are empty
  if (!text && !sendScreenshot) return

  // Change to generating state
  isGenerating = true
  sendBtn.title = 'Stop'
  sendBtn.setAttribute('aria-label', 'Stop generating')
  insertIcon(sendBtn, 'stop')
  messageInput.disabled = true

  try {
    // Add user message to UI (if text exists, otherwise use 'Assist' as default)
    const messageText = text || 'Assist'
    addMessage('user', messageText, sendHasScreenshot, sendScreenshot)

    // Clear input immediately for better UX
    messageInput.value = ''
    autosizeMessageInput()

    // Add loading indicator
    currentLoadingId = addLoadingMessage()
    inputContainer.classList.add('generating')
    if (modeDropdownInput.value === 'thinker') {
      inputContainer.classList.add('thinking')
    }

    // Reset streaming state
    currentStreamingMessageId = null
    accumulatedText = ''

    // Send to LLM with optional screenshot (returns immediately, streams via events)
    // If text is empty but screenshot exists, use 'Assist' as default prompt
    const promptText = text || 'Assist'

    // Check if we need to generate a summary
    if (memoryManager && memoryManager.shouldGenerateSummary()) {
      console.log('Generating conversation summary...')
      try {
        await memoryManager.generateSummary(async (messages) => {
          const result = await window.electronAPI.generateSummary(messages)
          if (!result.success) {
            throw new Error(result.error || 'Failed to generate summary')
          }
          return result.summary
        })
        console.log('Summary generated successfully')
      } catch (error) {
        console.error('Failed to generate summary:', error)
        // Continue without summary if generation fails
      }
    }

    // Get context from memory manager (summary + recent messages)
    const context = memoryManager ? memoryManager.getContextForRequest() : { summary: null, messages: [] }
    
    // Convert memory manager messages to conversation history format
    const conversationHistory = context.messages.map(m => ({
      type: m.role === 'user' ? 'user' : 'ai',
      text: m.content,
      // Only include screenshot in AI context if not excluded
      hasScreenshot: false, 
      timestamp: new Date(m.timestamp)
    }))

    console.log('Sending message to LLM...', { 
      hasScreenshot: sendHasScreenshot, 
      totalMessages: memoryManager ? memoryManager.messages.length : 0,
      sentMessages: conversationHistory.length,
      hasSummary: !!context.summary,
      memoryState: memoryManager ? memoryManager.getState() : null
    })
    
    const result = await window.electronAPI.sendMessage(
      promptText, 
      sendScreenshot, 
      conversationHistory,
      context.summary
    )

    // Remove loading indicator if it hasn't been removed by first chunk
    if (currentLoadingId) {
      removeLoadingMessage(currentLoadingId)
      currentLoadingId = null
    }

    if (!result.success) {
      // Some failures are returned without a message-error event (e.g., preflight checks).
      // Use deduped display to avoid duplicates when both return + event paths fire.
      showErrorDedup(result.error || 'Failed to get response')
      resetSendButton()
    } else {
      console.log('Streaming started from', result.provider)
      if (result.aborted) {
        resetSendButton()
      }
    }
  } catch (error) {
    console.error('Send message error:', error)
    showErrorDedup('Error: ' + error.message)
    resetSendButton()
  } finally {
    clearPredictiveScreenshot()

    // In manual mode, keep screenshots sticky across messages.
    // Users can toggle it off via the screenshot button.
    if (screenshotMode === 'manual') {
      if (!sendHasScreenshot) {
        removeScreenshot()
      }
    } else {
      // Keep icon "toggled on" in auto mode
      capturedScreenshot = null
      capturedThumbnail = null
      isScreenshotActive = true
      screenshotBtn.classList.add('active')
      screenshotBtn.classList.add('show-label')
      const label = document.getElementById('screenshot-label')
      if (label) label.textContent = 'Using screen'
      messageInput.placeholder = 'Ask about your screen or conversation, or ↩ for Assist'
    }
  }
}

/**
 * Setup hover preview for screenshot metadata
 * @param {HTMLElement} element - The "Sent with screenshot" element
 * @param {object} params - { sessionId, screenshotPath, base64 }
 */
/**
 * Handle streaming message chunk
 * @param {string} chunk - Text chunk from LLM
 */
function handleMessageChunk(chunk) {
  // Remove loading indicator on first chunk
  if (currentLoadingId) {
    removeLoadingMessage(currentLoadingId)
    currentLoadingId = null
  }

  // Accumulate text
  accumulatedText += chunk

  if (currentStreamingMessageId) {
    // Update existing message
    updateStreamingMessage(currentStreamingMessageId, accumulatedText)
  } else {
    // Create new streaming message
    currentStreamingMessageId = addStreamingMessage(accumulatedText)
  }
}

/**
 * Handle streaming completion
 */
function handleMessageComplete() {
  console.log('Streaming complete')
  inputContainer.classList.remove('generating')
  inputContainer.classList.remove('thinking')
  
  if (currentStreamingMessageId) {
    finalizeStreamingMessage(currentStreamingMessageId, accumulatedText)
  }
  
  currentStreamingMessageId = null
  accumulatedText = ''
  resetSendButton()
}

/**
 * Handle streaming error
 * @param {string} error - Error message
 */
function handleMessageError(error) {
  console.error('Streaming error:', error)
  inputContainer.classList.remove('generating')
  inputContainer.classList.remove('thinking')

  if (currentStreamingMessageId) {
    // Remove the incomplete streaming message
    const streamingEl = document.getElementById(currentStreamingMessageId)
    if (streamingEl) {
      streamingEl.remove()
    }
  }

  // Reset streaming state
  currentStreamingMessageId = null
  accumulatedText = ''

  // Show error
  showErrorDedup(error)
  resetSendButton()
}

/**
 * Add a message to the chat UI
 * @param {string} type - 'user' or 'ai'
 * @param {string} text - Message content
 * @param {boolean} hasScreenshot - Whether the message includes a screenshot
 */
function addMessage(type, text, hasScreenshot = false, screenshotBase64 = null) {
  // Remove empty state if it exists
  const emptyState = messagesContainer.querySelector('.empty-state')
  if (emptyState) {
    emptyState.remove()
  }

  // Create message element
  const messageEl = document.createElement('div')
  messageEl.className = `message ${type}`
  messageEl.textContent = text

  // Add to container
  chatWrapper.appendChild(messageEl)
  
  // Add screenshot indicator BELOW the user message bubble (as separate element)
  if (hasScreenshot && type === 'user') {
    const meta = document.createElement('div')
    meta.className = 'message-meta'
    meta.textContent = 'Sent with screenshot'
    
    // Setup hover preview
    setupScreenshotPreview(meta, () => ({
      sessionId: currentSessionId,
      screenshotPath: null,
      base64: screenshotBase64
    }), window.electronAPI.getScreenshot)

    chatWrapper.appendChild(meta)
  }
  
  // Scroll to bottom and update gradients
  scrollToBottom()

  // Store in message history (for UI/session persistence)
  const id = generateMessageId()

  const persistHasScreenshot = hasScreenshot && !(excludeScreenshotsFromMemory && type === 'user')
  const persistScreenshotBase64 = persistHasScreenshot && type === 'user' && typeof screenshotBase64 === 'string'
    ? screenshotBase64
    : null


  const persistScreenshotPath = persistHasScreenshot && type === 'user'
    ? `screenshots/${safePathPart(id) || id}.jpg`
    : undefined

  messages.push({
    id,
    type,
    text,
    hasScreenshot: persistHasScreenshot,
    screenshotPath: persistScreenshotPath,
    screenshotBase64: persistScreenshotBase64 || undefined,
    timestamp: new Date()
  })

  // Persist session after each message
  scheduleSessionSave()

  // Add to memory manager (for context optimization)
  if (memoryManager) {
    const role = type === 'user' ? 'user' : 'assistant'
    memoryManager.addMessage(role, text)
  }
}

/**
 * Add a loading indicator message with typing animation
 * @returns {string} - Loading message ID for removal
 */
function addLoadingMessage() {
  const loadingId = 'loading-' + Date.now()
  const loadingEl = document.createElement('div')
  loadingEl.className = 'message ai'
  loadingEl.id = loadingId

  // Create typing indicator with 3 bouncing dots
  const typingIndicator = document.createElement('div')
  typingIndicator.className = 'typing-indicator'

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('div')
    dot.className = 'typing-dot'
    typingIndicator.appendChild(dot)
  }

  loadingEl.appendChild(typingIndicator)

  chatWrapper.appendChild(loadingEl)
  scrollToBottom()

  return loadingId
}

/**
 * Remove the loading indicator message
 * @param {string} loadingId - ID of the loading message
 */
function removeLoadingMessage(loadingId) {
  const loadingEl = document.getElementById(loadingId)
  if (loadingEl) {
    loadingEl.remove()
  }
}

/**
 * Add a streaming message to the chat UI
 * @param {string} text - Initial text content
 * @returns {string} - Message ID
 */
function addStreamingMessage(text) {
  // Remove empty state if it exists
  const emptyState = messagesContainer.querySelector('.empty-state')
  if (emptyState) {
    emptyState.remove()
  }

  const messageId = 'streaming-' + Date.now()
  const messageEl = document.createElement('div')
  messageEl.className = 'message ai streaming'
  messageEl.id = messageId

  // Add text content with streaming cursor
  const contentEl = document.createElement('span')
  contentEl.className = 'streaming-content'
  contentEl.textContent = text
  messageEl.appendChild(contentEl)

  // Add blinking cursor
  const cursorEl = document.createElement('span')
  cursorEl.className = 'streaming-cursor'
  messageEl.appendChild(cursorEl)

  chatWrapper.appendChild(messageEl)
  scrollToBottom()

  return messageId
}

/**
 * Update a streaming message with new text
 * @param {string} messageId - Message ID
 * @param {string} text - Updated text content
 */
function updateStreamingMessage(messageId, text) {
  const messageEl = document.getElementById(messageId)
  if (messageEl) {
    // Check if user is near bottom BEFORE updating content
    const isNearBottom = isScrolledNearBottom()

    // Render markdown progressively during streaming
    const renderedHtml = renderMarkdown(text)

    // Replace content while preserving cursor
    const cursorEl = messageEl.querySelector('.streaming-cursor')
    messageEl.innerHTML = renderedHtml

    // Re-add cursor at the end
    if (cursorEl) {
      messageEl.appendChild(cursorEl)
    }

    // Add copy buttons to any code blocks
    addCopyButtons(messageEl)

    // Only auto-scroll if user was already near the bottom
    if (isNearBottom) {
      scrollToBottom()
    } else {
      // User has scrolled up - just update gradients/button
      updateScrollGradients()
    }
  }
}

/**
 * Finalize a streaming message (remove cursor, render markdown, store in history)
 * @param {string} messageId - Message ID
 * @param {string} text - Final text content
 */
function finalizeStreamingMessage(messageId, text) {
  const messageEl = document.getElementById(messageId)
  if (messageEl) {
    // Remove streaming class and cursor
    messageEl.classList.remove('streaming')
    const cursorEl = messageEl.querySelector('.streaming-cursor')
    if (cursorEl) {
      cursorEl.remove()
    }

    // Render markdown and LaTeX
    const renderedHtml = renderMarkdown(text)
    messageEl.innerHTML = renderedHtml

    // Add copy buttons to code blocks
    addCopyButtons(messageEl)

    // Add copy button to message (at bottom)
    addMessageCopyButton(messageEl, text)

    // Store in message history
    messages.push({ id: generateMessageId(), type: 'ai', text, hasScreenshot: false, timestamp: new Date() })

    // Add to memory manager
    if (memoryManager) {
      memoryManager.addMessage('assistant', text)
    }

    // Persist session after assistant message completes
    scheduleSessionSave()

    // Auto-title new sessions from the first assistant reply.
    maybeAutoTitleSessionFromFirstReply(text).catch(error => {
      console.error('Failed to auto-title session:', error)
    })
  }
}

/**
 * Add copy buttons and language labels to all code blocks in a message
 * @param {HTMLElement} messageElement - Message element containing code blocks
 */
function addCopyButtons(messageElement) {
  const codeBlocks = messageElement.querySelectorAll('pre code')
  const hljsLib = typeof globalThis !== 'undefined' ? globalThis.hljs : null

  codeBlocks.forEach(codeBlock => {
    if (hljsLib && !codeBlock.classList.contains('hljs')) {
      hljsLib.highlightElement(codeBlock)
    }

    const pre = codeBlock.parentElement
    if (pre.parentElement?.classList?.contains('code-block-wrapper')) {
      return
    }

    // Detect language from class attribute (e.g., "language-javascript" or "hljs javascript")
    let language = 'code'
    const classList = Array.from(codeBlock.classList)
    for (const className of classList) {
      if (className.startsWith('language-')) {
        language = className.replace('language-', '')
        break
      } else if (className.startsWith('hljs') && className !== 'hljs') {
        // highlight.js adds classes like "hljs javascript"
        const match = className.match(/^(\w+)$/)
        if (match && match[1] !== 'hljs') {
          language = match[1]
          break
        }
      }
    }
    // Also check next sibling classes for highlight.js
    if (language === 'code' && classList.length > 1) {
      const secondClass = classList[1]
      if (secondClass && secondClass !== 'hljs') {
        language = secondClass
      }
    }

    // Wrap in container for positioning
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block-wrapper'
    pre.parentNode.insertBefore(wrapper, pre)
    const header = document.createElement('div')
    header.className = 'code-block-header'
    wrapper.appendChild(header)
    wrapper.appendChild(pre)

    // Add language label
    const langLabel = document.createElement('span')
    langLabel.className = 'code-lang-label'
    langLabel.textContent = language
    header.appendChild(langLabel)

    // Create copy button with icon
    const copyBtn = document.createElement('button')
    copyBtn.className = 'copy-code-btn'
    copyBtn.title = 'Copy code'
    copyBtn.innerHTML = getIcon('copy', 'icon-svg-sm')
    copyBtn.addEventListener('click', () => {
      const code = codeBlock.textContent
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.innerHTML = getIcon('check', 'icon-svg-sm')
        copyBtn.classList.add('copied')
        copyBtn.title = 'Copied!'
        setTimeout(() => {
          copyBtn.innerHTML = getIcon('copy', 'icon-svg-sm')
          copyBtn.classList.remove('copied')
          copyBtn.title = 'Copy code'
        }, 2000)
      }).catch(err => {
        console.error('Failed to copy code:', err)
        copyBtn.title = 'Failed to copy'
        setTimeout(() => {
          copyBtn.innerHTML = getIcon('copy', 'icon-svg-sm')
          copyBtn.title = 'Copy code'
          }, 2000)
      })
    })

    header.appendChild(copyBtn)
  })
}

/**
 * Categorize error type based on error message
 * @param {string} errorText - Error message
 * @returns {string} - Error category
 */
function categorizeError(errorText) {
  const lowerError = errorText.toLowerCase()

  if (lowerError.includes('api key') || lowerError.includes('unauthorized') || lowerError.includes('invalid key')) {
    return 'API_KEY'
  }
  if (lowerError.includes('rate limit') || lowerError.includes('too many requests') || lowerError.includes('quota')) {
    return 'RATE_LIMIT'
  }
  if (lowerError.includes('network') || lowerError.includes('connection') || lowerError.includes('timeout')) {
    return 'NETWORK'
  }
  if (lowerError.includes('500') || lowerError.includes('503') || lowerError.includes('server error')) {
    return 'SERVER'
  }

  return 'UNKNOWN'
}

/**
 * Get user-friendly error message based on error type
 * @param {string} errorType - Error category
 * @returns {string} - User-friendly message
 */
function getErrorMessage(errorType) {
  const messages = {
    'API_KEY': 'Invalid or missing API key. Please check your settings.',
    'RATE_LIMIT': 'Rate limit exceeded. Please wait a moment before trying again.',
    'NETWORK': 'Network error. Please check your internet connection.',
    'SERVER': 'The AI service is temporarily unavailable. Please try again later.',
    'UNKNOWN': 'An error occurred. Please try again.'
  }

  return messages[errorType] || messages['UNKNOWN']
}

function showErrorDedup(errorText) {
  const normalized = String(errorText || '').trim().toLowerCase()
  const signature = normalized || 'unknown-error'
  const now = Date.now()

  if (signature === lastShownErrorSignature && now - lastShownErrorAt < 1500) {
    return
  }

  lastShownErrorSignature = signature
  lastShownErrorAt = now
  showError(errorText)
}

/**
 * Show an error message in the chat with categorization and actions
 * @param {string} errorText - Error message to display
 */
function showError(errorText) {
  const errorType = categorizeError(errorText)
  const errorEl = document.createElement('div')
  errorEl.className = 'message ai message-error-card'

  // Create error content
  const errorContent = document.createElement('div')
  errorContent.className = 'message-error-content'

  const errorHeader = document.createElement('div')
  errorHeader.className = 'message-error-header'

  const errorIconContainer = document.createElement('span')
  errorIconContainer.className = 'message-error-icon'
  errorIconContainer.innerHTML = getIcon('error', 'icon-svg-sm')
  errorHeader.appendChild(errorIconContainer)

  const errorMessage = document.createElement('span')
  errorMessage.className = 'message-error-text'
  errorMessage.textContent = getErrorMessage(errorType)
  errorHeader.appendChild(errorMessage)

  errorContent.appendChild(errorHeader)

  // Add technical details (collapsible)
  if (errorText !== getErrorMessage(errorType)) {
    const detailsToggle = document.createElement('div')
    detailsToggle.className = 'message-error-toggle'
    
    const chevronIcon = document.createElement('span')
    chevronIcon.innerHTML = getIcon('chevron-down', 'icon-svg-sm')
    detailsToggle.appendChild(chevronIcon)
    
    const toggleText = document.createElement('span')
    toggleText.textContent = 'Show details'
    detailsToggle.appendChild(toggleText)

    const detailsContent = document.createElement('div')
    detailsContent.className = 'message-error-details'
    detailsContent.style.display = 'none'
    detailsContent.textContent = errorText

    detailsToggle.addEventListener('click', () => {
      if (detailsContent.style.display === 'none') {
        detailsContent.style.display = 'block'
        chevronIcon.innerHTML = getIcon('chevron-up', 'icon-svg-sm')
        toggleText.textContent = 'Hide details'
      } else {
        detailsContent.style.display = 'none'
        chevronIcon.innerHTML = getIcon('chevron-down', 'icon-svg-sm')
        toggleText.textContent = 'Show details'
      }
    })

    errorContent.appendChild(detailsToggle)
    errorContent.appendChild(detailsContent)
  }

  errorEl.appendChild(errorContent)

  chatWrapper.appendChild(errorEl)
  scrollToBottom()

}

function showInterruptedMessage() {
  const interruptedEl = document.createElement('div')
  interruptedEl.className = 'message-notice'

  const icon = document.createElement('span')
  icon.className = 'message-notice-icon'
  icon.innerHTML = getIcon('stop', 'icon-svg-sm')
  interruptedEl.appendChild(icon)

  const text = document.createElement('span')
  text.textContent = 'Response interrupted.'
  interruptedEl.appendChild(text)

  chatWrapper.appendChild(interruptedEl)
  scrollToBottom()
}

/**
 * Add copy button to AI message
 * @param {HTMLElement} messageElement - Message element to add copy button to
 * @param {string} originalText - Original markdown text to copy
 */
function addMessageCopyButton(messageElement, originalText) {
  const copyBtn = document.createElement('button')
  copyBtn.className = 'message-copy-btn'
  copyBtn.innerHTML = getIcon('copy', 'icon-svg-sm')
  copyBtn.title = 'Copy message'
  
  copyBtn.addEventListener('click', async () => {
    const success = await copyToClipboard(originalText)
    if (success) {
      copyBtn.innerHTML = getIcon('check', 'icon-svg-sm')
      setTimeout(() => {
        copyBtn.innerHTML = getIcon('copy', 'icon-svg-sm')
      }, 2000)
    } else {
      showToast('Failed to copy message', 'error')
    }
  })

  messageElement.appendChild(copyBtn)
}

/**
 * Handle new chat event (Ctrl+R)
 * Clears all messages and resets state
 */
function handleNewChat() {
  console.log('Starting new chat...')

  // Clear message history
  messages.length = 0

  // Start a new persisted session
  currentSessionId = null
  sessionAutoTitleApplied = false
  if (sessionSaveTimer) {
    clearTimeout(sessionSaveTimer)
    sessionSaveTimer = null
  }

  // Clear memory manager conversation state
  if (memoryManager) {
    memoryManager.clearConversation()
  }

  // Reset UI to empty state
  messagesContainer.innerHTML = `
    <div class="chat-wrapper" id="chat-wrapper">
      <div class="empty-state">
        <img src="${appLogoSrc}" alt="Shade Logo" class="welcome-logo" />
        <h2>Welcome to Shade</h2>
        <p>Capture your screen and ask questions</p>
      </div>
    </div>
  `

  // Re-get chatWrapper reference since we just recreated it
  chatWrapper = document.getElementById('chat-wrapper')

  // Reset screenshot state
  removeScreenshot()

  // Clear predictive screenshot cache
  clearPredictiveScreenshot()

  // Clear input
  messageInput.value = ''
  autosizeMessageInput()
  messageInput.focus()
}

/**
 * Load modes and populate dropdown
 */
async function loadModes() {
  try {
    const result = await window.electronAPI.getModes()
    const modes = result.modes || []
    const activeModeResult = await window.electronAPI.getActiveMode()
    const activeModeId = activeModeResult.modeId || 'default'

    // Populate mode dropdown
    modeDropdownInput.innerHTML = ''
    modes.forEach(mode => {
      const option = document.createElement('option')
      option.value = mode.id
      option.textContent = mode.name
      modeDropdownInput.appendChild(option)
    })

    // Select the active mode
    modeDropdownInput.value = activeModeId

    console.log('Modes loaded:', { count: modes.length, active: activeModeId })
  } catch (error) {
    console.error('Failed to load modes:', error)
  }
}

/**
 * Handle mode switch from dropdown
 */
async function handleModeSwitch(event) {
  const modeId = event.target.value

  try {
    // Set active mode in config
    await window.electronAPI.setActiveMode(modeId)

    // If the mode defines provider/model defaults, apply them immediately
    const modesResult = await window.electronAPI.getModes()
    const modes = modesResult?.modes || []
    const mode = modes.find(m => m.id === modeId)

    if (mode?.provider) {
      await window.electronAPI.setActiveProvider(mode.provider)

      if (mode.model) {
        const cfg = await window.electronAPI.getProviderConfig(mode.provider)
        if (cfg?.success) {
          await window.electronAPI.setProviderConfig(mode.provider, { ...cfg.config, model: mode.model })
        }
      }
    }

    // Update dropdown
    modeDropdownInput.value = modeId

    console.log('Switched to mode:', modeId)
  } catch (error) {
    console.error('Failed to switch mode:', error)
    showError('Failed to switch mode: ' + error.message)
  }
}

function renderMarkdown(text) {
  return renderMarkdownSafe(text)
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
