/**
 * GhostPad Chat UI
 * Handles message display, screenshot capture, and user interactions
 */

// State management
const messages = [] // Chat history array
let capturedScreenshot = null // Current screenshot base64
let isScreenshotActive = false // Screenshot button state
let currentStreamingMessageId = null // ID of currently streaming message
let accumulatedText = '' // Accumulated text during streaming

// DOM element references
const messagesContainer = document.getElementById('messages-container')
const messageInput = document.getElementById('message-input')
const sendBtn = document.getElementById('send-btn')
const screenshotBtn = document.getElementById('screenshot-btn')
const homeBtn = document.getElementById('home-btn')
const closeBtn = document.getElementById('close-btn')
const modeDropdown = document.getElementById('mode-dropdown')

/**
 * Initialize the application
 */
async function init() {
  // Screenshot button - capture immediately and highlight icon
  screenshotBtn.addEventListener('click', handleScreenshotCapture)

  // Send button - send message with optional screenshot
  sendBtn.addEventListener('click', handleSendMessage)

  // Enter key to send message
  messageInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()

      // Ctrl+Enter: Quick send with screenshot (capture if needed)
      if (e.ctrlKey) {
        // If no screenshot captured yet, capture one first
        if (!isScreenshotActive) {
          await handleScreenshotCapture()
        }
        // Then send (even without text prompt)
        sendBtn.click()
      } else {
        // Regular Enter: send as normal
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

  // Mode dropdown - switch active mode
  modeDropdown.addEventListener('change', handleModeSwitch)

  // Ctrl+R new chat handler
  window.electronAPI.onNewChat(handleNewChat)

  // Streaming event handlers
  window.electronAPI.onMessageChunk(handleMessageChunk)
  window.electronAPI.onMessageComplete(handleMessageComplete)
  window.electronAPI.onMessageError(handleMessageError)

  // Load modes and populate dropdown
  await loadModes()

  // Auto-focus the input field so keyboard shortcuts work immediately
  messageInput.focus()

  console.log('GhostPad initialized')
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
      screenshotBtn.classList.add('active')
      isScreenshotActive = true
      console.log('Screenshot captured and attached')
    } else {
      console.error('Screenshot capture failed:', result.error)
      showError('Failed to capture screenshot')
    }
  } catch (error) {
    console.error('Screenshot error:', error)
    showError('Screenshot error: ' + error.message)
  }
}

/**
 * Handle sending a message
 */
async function handleSendMessage() {
  const text = messageInput.value.trim()

  // Don't send if both text and screenshot are empty
  if (!text && !capturedScreenshot) return

  // Disable send button during processing
  sendBtn.disabled = true
  messageInput.disabled = true

  try {
    // Add user message to UI (if text exists, otherwise just show screenshot indicator)
    const messageText = text || '[Analyzing screenshot...]'
    addMessage('user', messageText, isScreenshotActive)

    // Clear input immediately for better UX
    messageInput.value = ''

    // Add loading indicator
    const loadingId = addLoadingMessage()

    // Reset streaming state
    currentStreamingMessageId = null
    accumulatedText = ''

    // Send to LLM with optional screenshot (returns immediately, streams via events)
    // If text is empty but screenshot exists, use a default prompt
    const promptText = text || 'Analyze this screenshot and describe what you see.'
    console.log('Sending message to LLM...', { hasScreenshot: isScreenshotActive })
    const result = await window.electronAPI.sendMessage(promptText, capturedScreenshot)

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
    // Reset state
    capturedScreenshot = null
    screenshotBtn.classList.remove('active')
    isScreenshotActive = false

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

  // Add screenshot indicator for user messages with screenshots
  if (hasScreenshot && type === 'user') {
    const meta = document.createElement('div')
    meta.className = 'message-meta'
    meta.textContent = 'Sent with screenshot'
    messageEl.appendChild(meta)
  }

  // Add timestamp
  const timestamp = document.createElement('span')
  timestamp.className = 'message-timestamp'
  timestamp.textContent = formatTimestamp(new Date())
  messageEl.appendChild(timestamp)

  // Add to container and scroll to bottom
  messagesContainer.appendChild(messageEl)
  messagesContainer.scrollTop = messagesContainer.scrollHeight

  // Store in message history
  messages.push({ type, text, hasScreenshot, timestamp: new Date() })
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

  messagesContainer.appendChild(loadingEl)
  messagesContainer.scrollTop = messagesContainer.scrollHeight

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

  messagesContainer.appendChild(messageEl)
  messagesContainer.scrollTop = messagesContainer.scrollHeight

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

    messagesContainer.scrollTop = messagesContainer.scrollHeight
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

    // Add copy button to message
    addMessageCopyButton(messageEl, text)

    // Add timestamp
    const timestamp = document.createElement('span')
    timestamp.className = 'message-timestamp'
    timestamp.textContent = formatTimestamp(new Date())
    messageEl.appendChild(timestamp)

    // Store in message history
    messages.push({ type: 'ai', text, hasScreenshot: false, timestamp: new Date() })
  }
}

/**
 * Add copy buttons to all code blocks in a message
 * @param {HTMLElement} messageElement - Message element containing code blocks
 */
function addCopyButtons(messageElement) {
  const codeBlocks = messageElement.querySelectorAll('pre code')

  codeBlocks.forEach(codeBlock => {
    const pre = codeBlock.parentElement

    // Wrap in container for positioning
    const wrapper = document.createElement('div')
    wrapper.className = 'code-block-wrapper'
    pre.parentNode.insertBefore(wrapper, pre)
    wrapper.appendChild(pre)

    // Create copy button
    const copyBtn = document.createElement('button')
    copyBtn.className = 'copy-code-btn'
    copyBtn.textContent = 'Copy'
    copyBtn.addEventListener('click', () => {
      const code = codeBlock.textContent
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = 'Copied!'
        copyBtn.classList.add('copied')
        setTimeout(() => {
          copyBtn.textContent = 'Copy'
          copyBtn.classList.remove('copied')
        }, 2000)
      }).catch(err => {
        console.error('Failed to copy code:', err)
        copyBtn.textContent = 'Failed'
        setTimeout(() => {
          copyBtn.textContent = 'Copy'
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
  errorEl.style.borderColor = 'rgba(255, 74, 74, 0.3)'
  errorEl.style.background = 'rgba(255, 74, 74, 0.1)'
  errorEl.style.position = 'relative'

  // Create error content
  const errorContent = document.createElement('div')
  errorContent.style.paddingRight = '80px' // Make room for action button

  const errorIcon = document.createElement('span')
  errorIcon.textContent = '⚠️ '
  errorContent.appendChild(errorIcon)

  const errorMessage = document.createElement('span')
  errorMessage.textContent = getErrorMessage(errorType)
  errorContent.appendChild(errorMessage)

  // Add technical details (collapsible)
  if (errorText !== getErrorMessage(errorType)) {
    const detailsToggle = document.createElement('div')
    detailsToggle.style.fontSize = '11px'
    detailsToggle.style.opacity = '0.6'
    detailsToggle.style.marginTop = '6px'
    detailsToggle.style.cursor = 'pointer'
    detailsToggle.textContent = 'Show details'

    const detailsContent = document.createElement('div')
    detailsContent.style.fontSize = '11px'
    detailsContent.style.opacity = '0.6'
    detailsContent.style.marginTop = '6px'
    detailsContent.style.display = 'none'
    detailsContent.textContent = errorText

    detailsToggle.addEventListener('click', () => {
      if (detailsContent.style.display === 'none') {
        detailsContent.style.display = 'block'
        detailsToggle.textContent = 'Hide details'
      } else {
        detailsContent.style.display = 'none'
        detailsToggle.textContent = 'Show details'
      }
    })

    errorContent.appendChild(detailsToggle)
    errorContent.appendChild(detailsContent)
  }

  errorEl.appendChild(errorContent)

  // Add action button based on error type
  if (errorType === 'API_KEY') {
    const settingsBtn = document.createElement('button')
    settingsBtn.textContent = 'Settings'
    settingsBtn.style.position = 'absolute'
    settingsBtn.style.top = '12px'
    settingsBtn.style.right = '12px'
    settingsBtn.style.padding = '4px 12px'
    settingsBtn.style.background = 'rgba(74, 158, 255, 0.3)'
    settingsBtn.style.border = '1px solid rgba(74, 158, 255, 0.5)'
    settingsBtn.style.borderRadius = '4px'
    settingsBtn.style.color = 'white'
    settingsBtn.style.fontSize = '11px'
    settingsBtn.style.cursor = 'pointer'
    settingsBtn.addEventListener('click', () => {
      window.electronAPI.openSettings()
    })
    errorEl.appendChild(settingsBtn)
  }

  messagesContainer.appendChild(errorEl)
  messagesContainer.scrollTop = messagesContainer.scrollHeight
}

/**
 * Format timestamp with relative time
 * @param {Date} date - Message timestamp
 * @returns {string} - Formatted timestamp
 */
function formatTimestamp(date) {
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  // For older messages, show time
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Add copy button to AI message
 * @param {HTMLElement} messageElement - Message element to add copy button to
 * @param {string} originalText - Original markdown text to copy
 */
function addMessageCopyButton(messageElement, originalText) {
  const copyBtn = document.createElement('button')
  copyBtn.className = 'message-copy-btn'
  copyBtn.textContent = 'Copy'
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(originalText).then(() => {
      copyBtn.textContent = 'Copied!'
      copyBtn.classList.add('copied')
      setTimeout(() => {
        copyBtn.textContent = 'Copy'
        copyBtn.classList.remove('copied')
      }, 2000)
    }).catch(err => {
      console.error('Failed to copy message:', err)
      copyBtn.textContent = 'Failed'
      setTimeout(() => {
        copyBtn.textContent = 'Copy'
      }, 2000)
    })
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

  // Reset UI to empty state
  messagesContainer.innerHTML = `
    <div class="empty-state">
      <h2>Welcome to GhostPad</h2>
      <p>Capture your screen and ask questions</p>
    </div>
  `

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
    modeDropdown.innerHTML = ''
    modes.forEach(mode => {
      const option = document.createElement('option')
      option.value = mode.id
      option.textContent = mode.name
      modeDropdown.appendChild(option)
    })

    // Select the active mode
    modeDropdown.value = activeModeId

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
 * Render markdown with LaTeX support
 * @param {string} text - Raw markdown text
 * @returns {string} - Rendered HTML
 */
function renderMarkdown(text) {
  if (typeof marked === 'undefined') {
    return text // Fallback if marked is not loaded
  }

  try {
    // First, render markdown to HTML
    let html = marked.parse(text)

    // Create temporary element to apply LaTeX rendering
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = html

    // Render LaTeX using KaTeX auto-render if available
    if (typeof renderMathInElement !== 'undefined') {
      try {
        renderMathInElement(tempDiv, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '\\[', right: '\\]', display: true},
            {left: '$', right: '$', display: false},
            {left: '\\(', right: '\\)', display: false}
          ],
          throwOnError: false,
          strict: false
        })
      } catch (err) {
        console.error('KaTeX render error:', err)
      }
    }

    return tempDiv.innerHTML
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
