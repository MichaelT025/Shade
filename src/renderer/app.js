/**
 * Shade Chat UI
 * Handles message display, screenshot capture, and user interactions
 */

import { getIcon, insertIcon, initIcons } from './assets/icons/icons.js';
import { createScreenshotChip, formatTimestamp, showToast, copyToClipboard } from './utils/ui-helpers.js';
import MemoryManager from './utils/memory-manager.js';

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

// Behavior settings (from Configuration)
let screenshotMode = 'manual' // 'manual' | 'auto'
let excludeScreenshotsFromMemory = true
let autoTitleSessions = true
  let sessionAutoTitleApplied = false

let startCollapsedSetting = true

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
const modeDropdownInput = document.getElementById('mode-dropdown-input')
const newChatBtn = document.getElementById('new-chat-btn')
const scrollBottomBtn = document.getElementById('scroll-bottom-btn')

// Session persistence
let sessionSaveTimer = null

function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function safePathPart(value) {
  return (value || '').toString().replace(/[^a-zA-Z0-9_-]/g, '')
}

function toIsoTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return new Date().toISOString()
}

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

  const sessionPayload = {
    id: currentSessionId,
    title: '',
    createdAt: null,
    provider,
    model,
    messages: messages.map(m => ({
      id: m.id,
      type: m.type,
      text: m.text,
      hasScreenshot: !!m.hasScreenshot,
      ...(typeof m.screenshotPath === 'string' && m.screenshotPath ? { screenshotPath: m.screenshotPath } : {}),
      ...(typeof m.screenshotBase64 === 'string' && m.screenshotBase64 ? { screenshotBase64: m.screenshotBase64 } : {}),
      timestamp: toIsoTimestamp(m.timestamp)
    }))
  }

  const result = await window.electronAPI.saveSession(sessionPayload)
  if (result?.success && result.session?.id) {
    currentSessionId = result.session.id
  }

  // Once a screenshot message is persisted, keep only the on-disk reference.
  if (result?.success) {
    for (const m of messages) {
      if (m && typeof m.screenshotBase64 === 'string' && m.screenshotBase64 && typeof m.screenshotPath === 'string' && m.screenshotPath) {
        delete m.screenshotBase64
      }
    }
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
  for (const m of session.messages) {
    const type = m.type === 'ai' ? 'ai' : 'user'
    const text = typeof m.text === 'string' ? m.text : ''
    const hasScreenshot = !!m.hasScreenshot
    const timestamp = m.timestamp ? new Date(m.timestamp) : new Date()

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
      }))

      chatWrapper.appendChild(meta)
    }

    messages.push({
      id: typeof m.id === 'string' ? m.id : generateMessageId(),
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
    if (screenshotBtn) {
      const isAuto = screenshotMode === 'auto'
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
  })

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
    insertIcon(closeBtn, 'close', 'icon-svg')
    insertIcon(hideBtn, 'minus', 'icon-svg')
    insertIcon(newChatBtn, 'newchat', 'icon-svg')

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

  // Initialize collapsed state from settings
  isCollapsed = !!startCollapsedSetting
  updateCollapseState()

  window.electronAPI.onResumeSession((sessionId) => {
    loadSessionIntoChat(sessionId).catch(error => {
      console.error('Failed to resume session:', error)
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
    const result = await window.electronAPI.captureScreen()

    if (result.success) {
      capturedScreenshot = result.base64
      capturedThumbnail = result.thumbnail || result.base64 // Use thumbnail if available
      screenshotBtn.classList.add('active')
      isScreenshotActive = true
      screenshotBtn.title = 'Remove screenshot'
      
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
function showScreenshotChip(thumbnailBase64) {
  // Remove existing chip if any
  const existingChip = document.getElementById('screenshot-chip')
  if (existingChip) {
    existingChip.remove()
  }
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
  
  // Remove chip
  const chip = document.getElementById('screenshot-chip')
  if (chip) {
    chip.remove()
  }
  
  // Reset button state
  screenshotBtn.classList.remove('active')
  screenshotBtn.title = 'Capture Screenshot'
  
  // Reset placeholder
  messageInput.placeholder = 'Ask about your screen or conversation, or ↩ for Assist'
  
  console.log('Screenshot removed')
}

function resetSendButton() {
  isGenerating = false
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
    await window.electronAPI.stopMessage()
    resetSendButton()
    return
  }

  // Auto-expand on first message
  expand()

  const text = messageInput.value.trim()

  let sendScreenshot = capturedScreenshot
  let sendHasScreenshot = isScreenshotActive

  // Auto mode: capture a fresh screenshot for each message
  // Exception: if we already have a pre-captured screenshot (from Ctrl+Enter), use it
  if (screenshotMode === 'auto' && !capturedScreenshot) {
    sendScreenshot = null
    sendHasScreenshot = false

    // Capture screenshot if there's text, or skip for empty sends (prevents accidental Assist)
    if (text) {
      try {
        const captureResult = await window.electronAPI.captureScreen()
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
      // Show error message if initial request failed
      showError(result.error || 'Failed to get response')
      resetSendButton()
    } else {
      console.log('Streaming started from', result.provider)
      if (result.aborted) {
        resetSendButton()
      }
    }
  } catch (error) {
    console.error('Send message error:', error)
    showError('Error: ' + error.message)
    resetSendButton()
  } finally {
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
function setupScreenshotPreview(element, paramsOrGetter) {
  let popup = null
  let isHovering = false
  let hideTimeout = null
  let fetchPromise = null

  const getParams = () => {
    return typeof paramsOrGetter === 'function' ? paramsOrGetter() : paramsOrGetter
  }

  const showPopup = async () => {
    if (popup) return

    const params = getParams()
    if (!params) return

    // Fetch base64 if needed
    let imgSrc = params.base64
    
    // If no base64 but we have path, fetch it
    if (!imgSrc && params.sessionId && params.screenshotPath) {
      if (!fetchPromise) {
        fetchPromise = window.electronAPI.getScreenshot(params.sessionId, params.screenshotPath)
      }
      
      try {
        const result = await fetchPromise
        if (result.success && result.base64) {
          imgSrc = result.base64
        }
      } catch (e) {
        console.error('Failed to fetch screenshot preview', e)
        return
      }
    }

    if (!imgSrc) return
    if (!isHovering) return // User left while fetching

    popup = document.createElement('div')
    popup.className = 'screenshot-preview-popup'
    
    Object.assign(popup.style, {
      position: 'fixed',
      zIndex: '9999',
      background: 'var(--bg-secondary)',
      border: '2px solid var(--accent)',
      borderRadius: 'var(--radius-md)',
      padding: '4px',
      boxShadow: 'var(--shadow-glow), var(--shadow-elev-3)',
      width: '240px',
      height: 'auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: '0',
      transform: 'translateY(10px)',
      transition: 'opacity 0.2s ease, transform 0.2s ease',
      backdropFilter: 'var(--blur-overlay)',
      webkitBackdropFilter: 'var(--blur-overlay)'
    })

    const img = document.createElement('img')
    img.src = `data:image/jpeg;base64,${imgSrc}`
    
    Object.assign(img.style, {
      maxWidth: '100%',
      maxHeight: '100%',
      borderRadius: '0',
      display: 'block',
      border: '1px solid var(--accent-muted)'
    })
    
    popup.appendChild(img)
    document.body.appendChild(popup)

    // Keep popup alive when hovering it
    popup.addEventListener('mouseenter', () => {
      isHovering = true
      if (hideTimeout) clearTimeout(hideTimeout)
    })
    
    popup.addEventListener('mouseleave', () => {
      isHovering = false
      hidePopup()
    })

    // Position it
    const rect = element.getBoundingClientRect()
    const popupRect = popup.getBoundingClientRect()
    
    // Default: above the text
    let top = rect.top - popupRect.height - 12
    let left = rect.left + (rect.width / 2) - (popupRect.width / 2)
    
    // If not enough space on top, show below
    if (top < 10) {
        top = rect.bottom + 12
    }
    
    // Keep within horizontal bounds
    if (left < 10) left = 10
    if (left + popupRect.width > window.innerWidth - 10) {
        left = window.innerWidth - popupRect.width - 10
    }

    popup.style.top = `${top}px`
    popup.style.left = `${left}px`
    
    // Trigger animation
    requestAnimationFrame(() => {
      if (popup) {
        popup.style.opacity = '1'
        popup.style.transform = 'translateY(0)'
      }
    })
  }

  const hidePopup = () => {
    if (hideTimeout) clearTimeout(hideTimeout)
    hideTimeout = setTimeout(() => {
      if (!isHovering && popup) {
        popup.remove()
        popup = null
      }
    }, 150)
  }

  element.addEventListener('mouseenter', () => {
    isHovering = true
    if (hideTimeout) clearTimeout(hideTimeout)
    // Small delay to prevent flashing on accidental mouse over
    setTimeout(() => {
        if (isHovering) showPopup()
    }, 200) 
  })
  
  element.addEventListener('mouseleave', () => {
    isHovering = false
    hidePopup()
  })
}

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
  showError(error)
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
    }))

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
  }
}

/**
 * Add copy buttons and language labels to all code blocks in a message
 * @param {HTMLElement} messageElement - Message element containing code blocks
 */
function addCopyButtons(messageElement) {
  const codeBlocks = messageElement.querySelectorAll('pre code')

  codeBlocks.forEach(codeBlock => {
    const pre = codeBlock.parentElement

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
    wrapper.appendChild(pre)

    // Add language label
    const langLabel = document.createElement('span')
    langLabel.className = 'code-lang-label'
    langLabel.textContent = language
    wrapper.appendChild(langLabel)

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

    wrapper.appendChild(copyBtn)
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

/**
 * Show an error message in the chat with categorization and actions
 * @param {string} errorText - Error message to display
 */
function showError(errorText) {
  const errorType = categorizeError(errorText)
  const errorEl = document.createElement('div')
  errorEl.className = 'message ai'
  errorEl.style.borderColor = 'var(--danger)'
  errorEl.style.background = 'rgba(255, 107, 107, 0.1)'
  errorEl.style.position = 'relative'

  // Create error content
  const errorContent = document.createElement('div')
  errorContent.style.paddingRight = '80px' // Make room for action button

  const errorIconContainer = document.createElement('span')
  errorIconContainer.innerHTML = getIcon('error', 'icon-svg-sm')
  errorIconContainer.style.marginRight = '8px'
  errorIconContainer.style.color = 'var(--danger)'
  errorContent.appendChild(errorIconContainer)

  const errorMessage = document.createElement('span')
  errorMessage.textContent = getErrorMessage(errorType)
  errorContent.appendChild(errorMessage)

  // Add technical details (collapsible)
  if (errorText !== getErrorMessage(errorType)) {
    const detailsToggle = document.createElement('div')
    detailsToggle.className = 'text-xs text-tertiary'
    detailsToggle.style.marginTop = 'var(--space-8)'
    detailsToggle.style.cursor = 'pointer'
    detailsToggle.style.display = 'flex'
    detailsToggle.style.alignItems = 'center'
    detailsToggle.style.gap = 'var(--space-4)'
    
    const chevronIcon = document.createElement('span')
    chevronIcon.innerHTML = getIcon('chevron-down', 'icon-svg-sm')
    detailsToggle.appendChild(chevronIcon)
    
    const toggleText = document.createElement('span')
    toggleText.textContent = 'Show details'
    detailsToggle.appendChild(toggleText)

    const detailsContent = document.createElement('div')
    detailsContent.className = 'text-xs text-tertiary'
    detailsContent.style.marginTop = 'var(--space-8)'
    detailsContent.style.display = 'none'
    detailsContent.style.fontFamily = 'var(--font-family-mono)'
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

  // Add action button based on error type
  if (errorType === 'API_KEY') {
    const settingsBtn = document.createElement('button')
    settingsBtn.innerHTML = getIcon('settings', 'icon-svg-sm')
    settingsBtn.style.position = 'absolute'
    settingsBtn.style.top = 'var(--space-12)'
    settingsBtn.style.right = 'var(--space-12)'
    settingsBtn.style.padding = 'var(--space-4) var(--space-12)'
    settingsBtn.style.background = 'var(--accent-muted)'
    settingsBtn.style.border = '1px solid var(--accent)'
    settingsBtn.style.borderRadius = 'var(--radius-sm)'
    settingsBtn.style.color = 'var(--accent-strong)'
    settingsBtn.style.fontSize = 'var(--font-size-xs)'
    settingsBtn.style.cursor = 'pointer'
    settingsBtn.style.display = 'flex'
    settingsBtn.style.alignItems = 'center'
    settingsBtn.style.gap = 'var(--space-4)'
    settingsBtn.addEventListener('click', () => {
      window.electronAPI.openSettings()
    })
    errorEl.appendChild(settingsBtn)
  }

  chatWrapper.appendChild(errorEl)
  scrollToBottom()

  // Also show toast notification
  showToast(getErrorMessage(errorType), 'error')
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
      copyBtn.classList.add('copied')
      showToast('Message copied', 'success', 1500)
      setTimeout(() => {
        copyBtn.innerHTML = getIcon('copy', 'icon-svg-sm')
        copyBtn.classList.remove('copied')
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

  // Clear input
  messageInput.value = ''
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

/**
 * Configure marked.js for GitHub-flavored markdown with code highlighting
 */
if (typeof marked !== 'undefined') {
  marked.setOptions({
    gfm: true, // GitHub Flavored Markdown
    breaks: true, // Convert \n to <br>
    headerIds: false, // Don't add IDs to headers
    highlight: function(code, lang) {
      // Use highlight.js for code highlighting
      if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value
        } catch (err) {
          console.error('Highlight error:', err)
        }
      }
      // Auto-detect language if not specified
      if (typeof hljs !== 'undefined') {
        try {
          return hljs.highlightAuto(code).value
        } catch (err) {
          console.error('Auto-highlight error:', err)
        }
      }
      return code
    }
  })
}

/**
 * Extract and protect LaTeX blocks from text before markdown processing
 * This prevents markdown from corrupting LaTeX syntax
 * @param {string} text - Raw text with LaTeX
 * @returns {{text: string, blocks: Array}} - Text with placeholders and extracted blocks
 */
function extractLatexBlocks(text) {
  const blocks = []
  let placeholderIndex = 0

  // Patterns for LaTeX blocks (order matters - check longer/display patterns first)
  const patterns = [
    // Display math blocks (multi-line capable)
    /\$\$([\s\S]*?)\$\$/g,           // $$...$$
    /\\\[([\s\S]*?)\\\]/g,           // \[...\]
    // Inline math (single line, non-greedy)
    /\\\((.*?)\\\)/g,                // \(...\)
    /(?<!\$)\$(?!\$)([^\$\n]+?)\$/g  // $...$ (not $$ and not crossing newlines)
  ]

  // Extract each pattern type
  for (const pattern of patterns) {
    text = text.replace(pattern, (match) => {
      const placeholder = `%%LATEX_BLOCK_${placeholderIndex}%%`
      blocks.push({ placeholder, content: match })
      placeholderIndex++
      return placeholder
    })
  }

  return { text, blocks }
}

/**
 * Normalize LaTeX backslashes from OpenAI's inconsistent escaping
 * OpenAI sometimes sends \\frac instead of \frac, or \\\\ instead of \\
 * @param {string} latex - LaTeX string to normalize
 * @returns {string} - Normalized LaTeX
 */
function normalizeLatexBackslashes(latex) {
  // Don't process if it looks already correct
  if (!latex.includes('\\\\')) {
    return latex
  }

  // Normalize quadruple backslashes to double (for line breaks in aligned environments)
  latex = latex.replace(/\\\\\\\\/g, '\\\\')

  // Normalize double-escaped commands back to single
  // Match \\commandname and convert to \commandname
  // But preserve \\ for line breaks in environments
  latex = latex.replace(/\\\\([a-zA-Z]+)/g, '\\$1')

  // Normalize double-escaped delimiters
  latex = latex.replace(/\\\\\[/g, '\\[')
  latex = latex.replace(/\\\\\]/g, '\\]')
  latex = latex.replace(/\\\\\(/g, '\\(')
  latex = latex.replace(/\\\\\)/g, '\\)')

  return latex
}

/**
 * Restore LaTeX blocks and render them with KaTeX
 * @param {string} html - HTML with placeholders
 * @param {Array} blocks - Extracted LaTeX blocks
 * @returns {string} - HTML with rendered LaTeX
 */
function restoreAndRenderLatex(html, blocks) {
  if (typeof katex === 'undefined') {
    // Fallback: just restore the original LaTeX text
    for (const block of blocks) {
      html = html.replace(block.placeholder, block.content)
    }
    return html
  }

  for (const block of blocks) {
    let latex = block.content
    let displayMode = false

    // Determine display mode and extract inner content
    if (latex.startsWith('$$') && latex.endsWith('$$')) {
      latex = latex.slice(2, -2)
      displayMode = true
    } else if (latex.startsWith('\\[') && latex.endsWith('\\]')) {
      latex = latex.slice(2, -2)
      displayMode = true
    } else if (latex.startsWith('\\(') && latex.endsWith('\\)')) {
      latex = latex.slice(2, -2)
      displayMode = false
    } else if (latex.startsWith('$') && latex.endsWith('$')) {
      latex = latex.slice(1, -1)
      displayMode = false
    }

    // Normalize backslashes for OpenAI's inconsistent escaping
    latex = normalizeLatexBackslashes(latex.trim())

    try {
      const rendered = katex.renderToString(latex, {
        displayMode: displayMode,
        throwOnError: false,
        strict: false,
        trust: false // Security: disable trust to prevent macro exploits
      })
      html = html.replace(block.placeholder, rendered)
    } catch (err) {
      console.error('KaTeX render error for block:', err, latex)
      // Fallback: show original LaTeX in a styled span
      const escaped = latex.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const fallback = `<span class="latex-error" title="LaTeX render error">${escaped}</span>`
      html = html.replace(block.placeholder, fallback)
    }
  }

  return html
}

/**
 * Render markdown with LaTeX support
 * Uses pre-processing to protect LaTeX from markdown parser corruption
 * @param {string} text - Raw markdown text
 * @returns {string} - Rendered HTML
 */
function renderMarkdown(text) {
  if (typeof marked === 'undefined') {
    return text // Fallback if marked is not loaded
  }

  try {
    // Step 1: Extract and protect LaTeX blocks before markdown processing
    const { text: textWithPlaceholders, blocks } = extractLatexBlocks(text)

    // Step 2: Render markdown (LaTeX is now protected by placeholders)
    let html = marked.parse(textWithPlaceholders)

    // Step 3: Restore LaTeX blocks and render with KaTeX
    html = restoreAndRenderLatex(html, blocks)

    // Step 4: Sanitize HTML to prevent XSS from untrusted LLM output
    if (typeof DOMPurify !== 'undefined') {
      html = DOMPurify.sanitize(html, {
        ADD_TAGS: ['semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mroot', 'msqrt', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace', 'mover', 'munder', 'munderover', 'math'],
        ADD_ATTR: ['mathvariant', 'encoding', 'xmlns', 'display', 'accent', 'accentunder', 'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'aria-hidden']
      })
    }

    return html
  } catch (err) {
    console.error('Markdown render error:', err)
    return text // Fallback to plain text on error
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
