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
let currentStreamingMessageId = null // ID of currently streaming message
let accumulatedText = '' // Accumulated text during streaming
let isCollapsed = true // Overlay collapse state (starts collapsed)

// DOM element references
const messagesContainer = document.getElementById('messages-container')
let chatWrapper = document.getElementById('chat-wrapper') // Use let for reassignment after new chat
const messageInput = document.getElementById('message-input')
const sendBtn = document.getElementById('send-btn')
const screenshotBtn = document.getElementById('screenshot-btn')
const homeBtn = document.getElementById('home-btn')
const closeBtn = document.getElementById('close-btn')
const hideBtn = document.getElementById('hide-btn')
const collapseBtn = document.getElementById('collapse-btn')
const modeDropdownInput = document.getElementById('mode-dropdown-input')
const displayBtn = document.getElementById('display-btn')
const scrollBottomBtn = document.getElementById('scroll-bottom-btn')

// Session persistence
let sessionSaveTimer = null

function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
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
      timestamp: toIsoTimestamp(m.timestamp)
    }))
  }

  const result = await window.electronAPI.saveSession(sessionPayload)
  if (result?.success && result.session?.id) {
    currentSessionId = result.session.id
  }
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
 * Initialize the application
 */
async function init() {
  // Initialize memory manager with history limit from settings
  const historyLimitResult = await window.electronAPI.getHistoryLimit()
  const historyLimit = historyLimitResult.success ? historyLimitResult.limit : 10
  memoryManager = new MemoryManager(historyLimit)
  console.log('MemoryManager initialized with limit:', historyLimit)

  // Screenshot button - capture immediately and highlight icon
  screenshotBtn.addEventListener('click', handleScreenshotCapture)

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
        if (!isScreenshotActive) {
          await handleScreenshotCapture()
        }
        sendBtn.click()
      } else {
        sendBtn.click()
      }
    }
  })

  // Home button - open settings window
  homeBtn.addEventListener('click', () => {
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

  // Display button - show coming soon toast
  displayBtn.addEventListener('click', () => {
    showToast('Multi-monitor support coming soon!', 'info', 3000)
  })

  // Mode dropdown - switch active mode
  modeDropdownInput.addEventListener('change', handleModeSwitch)

  // Ctrl+R new chat handler
  window.electronAPI.onNewChat(handleNewChat)

  // Config changed handler (from settings window)
  window.electronAPI.onConfigChanged(async () => {
    console.log('Config changed, refreshing modes...')
    await loadModes()

    // Update memory manager with new history limit
    const historyLimitResult = await window.electronAPI.getHistoryLimit()
    if (historyLimitResult.success && memoryManager) {
      memoryManager.updateHistoryLimit(historyLimitResult.limit)
    }
  })

  // Streaming event handlers
  window.electronAPI.onMessageChunk(handleMessageChunk)
  window.electronAPI.onMessageComplete(handleMessageComplete)
  window.electronAPI.onMessageError(handleMessageError)

  // Collapse toggle event handler (Ctrl+')
  window.electronAPI.onToggleCollapse(toggleCollapse)

  // Initialize custom icons from directory
  await initIcons()

   // Insert icons into UI elements
   insertIcon(homeBtn, 'settings', 'icon-svg')
   insertIcon(displayBtn, 'display', 'icon-svg')
   insertIcon(closeBtn, 'close', 'icon-svg')
   insertIcon(hideBtn, 'minus', 'icon-svg')
   insertIcon(collapseBtn, 'collapse', 'icon-svg')
   insertIcon(screenshotBtn, 'camera', 'icon-svg')
   insertIcon(sendBtn, 'send', 'icon-svg')
   insertIcon(scrollBottomBtn, 'arrow-down', 'icon-svg')

  // Load modes and populate dropdown
  await loadModes()

  // Set up scroll gradient detection
  messagesContainer.addEventListener('scroll', updateScrollGradients)
  updateScrollGradients() // Initial check

  // Auto-focus the input field so keyboard shortcuts work immediately
  messageInput.focus()

  // Initialize collapsed state (starts collapsed)
  updateCollapseState()

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
      
      // Show screenshot chip preview
      // showScreenshotChip(capturedThumbnail)
      
      // Update input placeholder
      messageInput.placeholder = 'Ask about the captured screen...'
      
      console.log('Screenshot captured and attached')
      // showToast('Screenshot captured', 'success', 2000)
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
  
  // Create and insert new chip
  // const chip = createScreenshotChip(thumbnailBase64)
  // const inputArea = document.querySelector('.input-area')
  // const inputContainer = document.querySelector('.input-container')
  // inputArea.insertBefore(chip, inputContainer)
  
  // Add remove button handler
  // const removeBtn = document.getElementById('screenshot-remove')
  // removeBtn.addEventListener('click', removeScreenshot)
}

/**
 * Remove screenshot
 */
function removeScreenshot() {
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
  
  // Reset placeholder
  messageInput.placeholder = 'Ask about your screen or conversation, or ↩ for Assist'
  
  console.log('Screenshot removed')
}

/**
 * Handle sending a message
 */
async function handleSendMessage() {
  // Auto-expand on first message
  expand()

  const text = messageInput.value.trim()

  // Don't send if both text and screenshot are empty
  if (!text && !capturedScreenshot) return

  // Disable send button during processing
  sendBtn.disabled = true
  messageInput.disabled = true

  try {
    // Add user message to UI (if text exists, otherwise use 'Assist' as default)
    const messageText = text || 'Assist'
    addMessage('user', messageText, isScreenshotActive)

    // Clear input immediately for better UX
    messageInput.value = ''

    // Add loading indicator
    const loadingId = addLoadingMessage()

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
      hasScreenshot: false,
      timestamp: new Date(m.timestamp)
    }))

    console.log('Sending message to LLM...', { 
      hasScreenshot: isScreenshotActive, 
      totalMessages: memoryManager ? memoryManager.messages.length : 0,
      sentMessages: conversationHistory.length,
      hasSummary: !!context.summary,
      memoryState: memoryManager ? memoryManager.getState() : null
    })
    
    const result = await window.electronAPI.sendMessage(
      promptText, 
      capturedScreenshot, 
      conversationHistory,
      context.summary
    )

    // Remove loading indicator
    removeLoadingMessage(loadingId)

    if (!result.success) {
      // Show error message if initial request failed
      showError(result.error || 'Failed to get response')
    } else {
      console.log('Streaming started from', result.provider)
    }
  } catch (error) {
    console.error('Send message error:', error)
    showError('Error: ' + error.message)
  } finally {
    // Clear screenshot after sending
    removeScreenshot()

    // Re-enable input
    sendBtn.disabled = false
    messageInput.disabled = false
    messageInput.focus()
  }
}

/**
 * Handle streaming message chunk
 * @param {string} chunk - Text chunk from LLM
 */
function handleMessageChunk(chunk) {
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
  if (currentStreamingMessageId) {
    // Finalize the message (remove cursor, store in history)
    finalizeStreamingMessage(currentStreamingMessageId, accumulatedText)
  }

  // Reset streaming state
  currentStreamingMessageId = null
  accumulatedText = ''
}

/**
 * Handle streaming error
 * @param {string} error - Error message
 */
function handleMessageError(error) {
  console.error('Streaming error:', error)

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
}

/**
 * Add a message to the chat UI
 * @param {string} type - 'user' or 'ai'
 * @param {string} text - Message content
 * @param {boolean} hasScreenshot - Whether the message includes a screenshot
 */
function addMessage(type, text, hasScreenshot = false) {
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
    chatWrapper.appendChild(meta)
  }
  
  // Scroll to bottom and update gradients
  scrollToBottom()

  // Store in message history (for UI)
  messages.push({ id: generateMessageId(), type, text, hasScreenshot, timestamp: new Date() })

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
        <h2>Welcome to Shade</h2>
        <p>Capture your screen and ask questions</p>
      </div>
    </div>
  `

  // Re-get chatWrapper reference since we just recreated it
  chatWrapper = document.getElementById('chat-wrapper')

  // Reset screenshot state
  capturedScreenshot = null
  screenshotBtn.classList.remove('active')
  isScreenshotActive = false

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
        trust: true
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
