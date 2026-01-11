const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs').promises
const { captureAndCompress } = require('../services/screen-capture')
const LLMFactory = require('../services/llm-factory')
const ConfigService = require('../services/config-service')
const SessionStorage = require('../services/session-storage')

let mainWindow = null
let settingsWindow = null
let modelSwitcherWindow = null
let configService = null
let sessionStorage = null
let overlayExpandedBounds = null
let overlayCollapsedBounds = null
let overlayIsCollapsed = false

// Global state for current message request to allow interruption
let currentAbortController = null

function sendToWindows(channel, ...args) {
  ;[mainWindow, settingsWindow, modelSwitcherWindow].forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  })
}

function broadcastConfigChanged() {
  sendToWindows('config-changed')
}

// Path to renderer assets (Vite build output in production, source files in dev)
const rendererPath = !app.isPackaged 
  ? path.join(__dirname, '../renderer')
  : path.join(__dirname, '../../dist/renderer')

// BrowserWindow's `icon` is mainly relevant on Windows/Linux. On macOS the app icon
// comes from the bundled .icns at build time, but we still provide a valid path so
// `npm start` works cross-platform.
const getIconPath = () => {
  return process.platform === 'win32'
    ? path.join(__dirname, '../../build/icon.ico')
    : path.join(__dirname, '../../build/appicon.png')
}

// Create the main overlay window
function createMainWindow() {
  // Get primary display work area
  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { workArea } = primaryDisplay

  // Calculate position - right side but more centered vertically
  const width = 500
  const height = 450
  const paddingRight = 100  // More space from right edge
  const paddingTop = 80     // More space from top edge
  
  const x = workArea.x + workArea.width - width - paddingRight
  const y = workArea.y + paddingTop

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: x,
    y: y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    minWidth: 450,
    minHeight: 400, // Start with expanded constraint
    maxWidth: 1000,
    maxHeight: 1000,
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  overlayExpandedBounds = mainWindow.getBounds()

  // Allow window in system screenshots by default (PrtSc, etc.)
  // Content protection will be enabled temporarily during app screenshot capture
  mainWindow.setContentProtection(false)

// Load the overlay
  mainWindow.loadFile(path.join(rendererPath, 'index.html'))

  // Track both expanded and collapsed bounds so resizing in either state is preserved
  // Synchronize x, y, and width across both states whenever one is moved or resized
  const syncBounds = () => {
    if (!mainWindow) return
    const currentBounds = mainWindow.getBounds()

    if (overlayIsCollapsed) {
      overlayCollapsedBounds = currentBounds
      if (overlayExpandedBounds) {
        overlayExpandedBounds = {
          ...overlayExpandedBounds,
          x: currentBounds.x,
          y: currentBounds.y,
          width: currentBounds.width
        }
      }
    } else {
      overlayExpandedBounds = currentBounds
      if (overlayCollapsedBounds) {
        overlayCollapsedBounds = {
          ...overlayCollapsedBounds,
          x: currentBounds.x,
          y: currentBounds.y,
          width: currentBounds.width
        }
      }
    }
  }

  mainWindow.on('resize', syncBounds)
  mainWindow.on('move', syncBounds)

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Create the dashboard window (replaces standalone settings)
function createDashboardWindow() {
  // Don't create if already exists
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore()
    }
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { workArea } = primaryDisplay

  const dashboardWidth = 980
  const dashboardHeight = 720

  // Keep dashboard clear of the right-edge overlay by default
  const overlayWidth = 500
  const overlayPaddingRight = 100
  const gapBetweenWindows = 60

  const overlayLeft = workArea.x + workArea.width - overlayWidth - overlayPaddingRight
  let dashboardX = overlayLeft - gapBetweenWindows - dashboardWidth

  // Clamp so the dashboard never goes off the left edge
  const minMarginLeft = 24
  if (dashboardX < workArea.x + minMarginLeft) {
    dashboardX = workArea.x + minMarginLeft
  }

  const dashboardY = workArea.y + Math.max(40, Math.round((workArea.height - dashboardHeight) / 2))

  settingsWindow = new BrowserWindow({
    width: dashboardWidth,
    height: dashboardHeight,
    x: dashboardX,
    y: dashboardY,
    modal: false,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    backgroundColor: '#00000000',
    minWidth: 800,
    minHeight: 600,
    maxWidth: 2000,
    maxHeight: 1400,
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Load dashboard/homepage
  settingsWindow.loadFile(path.join(rendererPath, 'homepage.html'))

  // Show when ready
  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show()
  })

  // Handle window closed
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

function createModelSwitcherWindow() {
  // Don't create if already exists
  if (modelSwitcherWindow && !modelSwitcherWindow.isDestroyed()) {
    if (modelSwitcherWindow.isMinimized()) {
      modelSwitcherWindow.restore()
    }
    modelSwitcherWindow.show()
    modelSwitcherWindow.focus()
    return
  }

  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { workArea } = primaryDisplay

  const width = 520
  const height = 640

  let x = workArea.x + Math.round((workArea.width - width) / 2)
  let y = workArea.y + Math.round((workArea.height - height) / 3)

  // Position near the overlay if available.
  if (mainWindow && !mainWindow.isDestroyed()) {
    const overlayBounds = mainWindow.getBounds()
    const gap = 16

    const leftCandidate = overlayBounds.x - gap - width
    const rightCandidate = overlayBounds.x + overlayBounds.width + gap

    if (leftCandidate >= workArea.x + 12) {
      x = leftCandidate
      y = Math.max(workArea.y + 12, Math.min(overlayBounds.y, workArea.y + workArea.height - height - 12))
    } else if (rightCandidate + width <= workArea.x + workArea.width - 12) {
      x = rightCandidate
      y = Math.max(workArea.y + 12, Math.min(overlayBounds.y, workArea.y + workArea.height - height - 12))
    }
  }

  modelSwitcherWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    modal: false,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  modelSwitcherWindow.loadFile(path.join(rendererPath, 'model-switcher.html'))

  modelSwitcherWindow.once('ready-to-show', () => {
    modelSwitcherWindow.show()
    modelSwitcherWindow.focus()
  })

  // Close when user clicks elsewhere.
  modelSwitcherWindow.on('blur', () => {
    if (modelSwitcherWindow && !modelSwitcherWindow.isDestroyed()) {
      modelSwitcherWindow.close()
    }
  })

  modelSwitcherWindow.on('closed', () => {
    modelSwitcherWindow = null
  })
}

// Register global hotkeys
function registerHotkeys() {
  const isOverlayVisible = () => {
    if (!mainWindow) return false
    // Treat minimized/hidden as "overlay hidden" for shortcut gating.
    if (mainWindow.isMinimized()) return false
    if (typeof mainWindow.isVisible === 'function' && !mainWindow.isVisible()) return false
    return true
  }

  // Ctrl+/ to toggle window visibility (minimize to taskbar)
  globalShortcut.register('CommandOrControl+/', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
        mainWindow.focus()
      } else {
        mainWindow.minimize()
      }
    }
  })

  // Ctrl+R to start new chat
  globalShortcut.register('CommandOrControl+R', () => {
    if (!isOverlayVisible()) return
    mainWindow.webContents.send('new-chat')
  })

  // Ctrl+' to toggle overlay collapse
  globalShortcut.register('CommandOrControl+\'', () => {
    if (!isOverlayVisible()) return
    mainWindow.webContents.send('toggle-collapse')
  })

  // Ctrl+Shift+S to capture screenshot
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (!isOverlayVisible()) return
    mainWindow.webContents.send('capture-screenshot')
  })

  // Ctrl+M to open model switcher
  // On macOS, Cmd+M is the standard "minimize window" shortcut, so avoid overriding it.
  const modelSwitcherShortcut = process.platform === 'darwin'
    ? 'CommandOrControl+Shift+M'
    : 'CommandOrControl+M'

  globalShortcut.register(modelSwitcherShortcut, () => {
    if (!isOverlayVisible()) return
    createModelSwitcherWindow()
  })
}

// App lifecycle events
app.whenReady().then(() => {
  // Initialize config service with user data path
  const userDataPath = app.getPath('userData')
  configService = new ConfigService(userDataPath)
  sessionStorage = new SessionStorage(userDataPath)

  // Best-effort cleanup (do not block app startup)
  sessionStorage.cleanupOldSessions().catch(error => {
    console.error('Failed to cleanup old sessions:', error)
  })

  // Best-effort model refresh on startup so the UI isn't stuck on defaults.
  ;(async () => {
    try {
      const ModelRefreshService = require('../services/model-refresh')
      const providerIds = LLMFactory.getAvailableProviders()

      await Promise.all(providerIds.map(async (providerId) => {
        const meta = LLMFactory.getProviderMeta(providerId)
        const apiKey = configService.getApiKey(providerId)

        const requiresApiKey = meta?.requiresApiKey !== undefined
          ? meta.requiresApiKey
          : meta?.type !== 'openai-compatible'

        if (requiresApiKey && !apiKey && meta?.type !== 'anthropic') return

        await ModelRefreshService.refreshModels(providerId, apiKey)
      }))
    } catch (error) {
      console.error('Startup model refresh failed:', error)
    }
  })()

  createMainWindow()
  registerHotkeys()

  // On macOS it's common to re-create a window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Unregister shortcuts when app quits
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// IPC Handlers
ipcMain.handle('capture-screen', async () => {
  try {
    console.log('Screen capture requested')

    // Temporarily enable content protection to exclude app from this capture
    if (mainWindow) {
      mainWindow.setContentProtection(true)
    }

    // Small delay to ensure content protection takes effect
    await new Promise(resolve => setTimeout(resolve, 100))

    // Capture and compress the screenshot
    // The overlay is now excluded via temporary setContentProtection(true)
    const { base64, size } = await captureAndCompress()

    console.log(`Screenshot captured successfully (${(size / 1024 / 1024).toFixed(2)}MB)`)

    return {
      success: true,
      base64,
      size
    }
  } catch (error) {
    console.error('Failed to capture screen:', error)

    return {
      success: false,
      error: error.message
    }
  } finally {
    // Always re-disable content protection so app is visible in system screenshots (PrtSc)
    if (mainWindow) {
      mainWindow.setContentProtection(false)
    }
  }
})

// Helper function to check if provider is local (doesn't require API key)
function isLocalProvider(providerName) {
  try {
    const meta = LLMFactory.getProviderMeta(providerName)
    if (!meta) return false

    // Prefer explicit flag (used for openai-compatible providers).
    if (meta.requiresApiKey === false) return true

    // Fallback: treat localhost OpenAI-compatible endpoints as local.
    return meta.type === 'openai-compatible' && typeof meta.baseUrl === 'string' && meta.baseUrl.includes('localhost')
  } catch {
    return false
  }
}

ipcMain.handle('send-message', async (event, { text, imageBase64, conversationHistory, summary }) => {
  try {
    console.log('Message send requested:', text, { hasSummary: !!summary })

    // Cancel any existing request
    if (currentAbortController) {
      currentAbortController.abort()
    }
    currentAbortController = new AbortController()

    // Get active provider from Configuration (default)
    let providerName = configService.getActiveProvider()

    // Apply optional per-mode override without mutating Configuration
    const activeModeId = configService.getActiveMode()
    const activeMode = configService.getMode(activeModeId)
    if (activeMode?.overrideProviderModel && activeMode?.provider) {
      providerName = activeMode.provider
    }

    const apiKey = configService.getApiKey(providerName)

    // Only require API key for non-local providers
    if (!isLocalProvider(providerName) && !apiKey) {
      return {
        success: false,
        error: `No API key configured for ${providerName}. Please add your API key in settings.`
      }
    }

    // Get provider configuration and merge with active mode's system prompt
    const config = configService.getProviderConfig(providerName)
    const activeSystemPrompt = configService.getActiveSystemPrompt()

    const configWithPrompt = {
      ...config,
      systemPrompt: activeSystemPrompt
    }

    // Mode override: optionally override the model used for the request
    if (activeMode?.overrideProviderModel && activeMode?.provider) {
      if (activeMode.provider === providerName && activeMode.model) {
        configWithPrompt.model = activeMode.model
      }
    }

    // Create provider instance
    const provider = LLMFactory.createProvider(providerName, apiKey, configWithPrompt)

    // Handle summary by prepending to conversation context
    let historyWithSummary = conversationHistory || []
    let promptWithSummary = text
    
    if (summary) {
      // If we have conversation history, prepend summary to the first message
      if (historyWithSummary.length > 0) {
        const firstMsg = historyWithSummary[0]
        historyWithSummary = [
          {
            ...firstMsg,
            text: `[Context from earlier conversation: ${summary}]\n\n${firstMsg.text}`
          },
          ...historyWithSummary.slice(1)
        ]
      } else {
        // If no history, prepend summary to current prompt
        promptWithSummary = `[Context from earlier conversation: ${summary}]\n\n${text}`
      }
    }

    // Stream response chunks to renderer
    await provider.streamResponse(promptWithSummary, imageBase64, historyWithSummary, (chunk) => {
      event.sender.send('message-chunk', chunk)
    }, currentAbortController.signal)

    // Signal completion
    event.sender.send('message-complete')

    console.log('Response streaming completed')

    return {
      success: true,
      provider: providerName
    }
  } catch (error) {
    if (error.name === 'AbortError' || error.message?.includes('abort')) {
      console.log('Request aborted by user')
      return { success: true, aborted: true }
    }
    console.error('Failed to send message:', error)

    // Send error to renderer
    event.sender.send('message-error', error.message)

    return {
      success: false,
      error: error.message
    }
  } finally {
    currentAbortController = null
  }
})

ipcMain.handle('stop-message', async () => {
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
    console.log('User requested to stop message generation')
    return { success: true }
  }
  return { success: false }
})

// Generate conversation summary
ipcMain.handle('generate-summary', async (_event, messages) => {
  try {
    console.log('Summary generation requested for', messages.length, 'messages')

    // Get active provider and API key
    const providerName = configService.getActiveProvider()
    const apiKey = configService.getApiKey(providerName)

    // Only require API key for non-local providers
    if (!isLocalProvider(providerName) && !apiKey) {
      return {
        success: false,
        error: `No API key configured for ${providerName}`
      }
    }

    // Get provider configuration WITHOUT system prompt for summary generation
    // This prevents context bleed between chats (especially for Gemini)
    const config = configService.getProviderConfig(providerName)
    const summaryConfig = {
      ...config,
      systemPrompt: '' // Clear system prompt for summary generation
    }

    // Create provider instance
    const provider = LLMFactory.createProvider(providerName, apiKey, summaryConfig)

    // Build summary prompt
    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 500)}`)
      .join('\n\n')

    const summaryPrompt = `Summarize this conversation concisely (under 200 words). Focus on:
- Main topics discussed
- Key decisions or conclusions
- Important context for future messages

Conversation:
${conversationText}

Provide a clear, contextual summary:`

    // Generate summary (non-streaming)
    let summary = ''
    await provider.streamResponse(summaryPrompt, null, [], (chunk) => {
      summary += chunk
    })

    console.log('Summary generated:', summary.length, 'characters')

    return {
      success: true,
      summary: summary.trim()
    }
  } catch (error) {
    console.error('Failed to generate summary:', error)
    return {
      success: false,
      error: error.message
    }
  }
})

ipcMain.handle('generate-session-title', async (_event, assistantReply) => {
  try {
    const replyText = typeof assistantReply === 'string' ? assistantReply.trim() : ''
    if (!replyText) {
      return { success: false, error: 'Empty reply' }
    }

    const providerName = configService.getActiveProvider()
    const apiKey = configService.getApiKey(providerName)

    if (!isLocalProvider(providerName) && !apiKey) {
      return { success: false, error: `No API key configured for ${providerName}` }
    }

    const config = configService.getProviderConfig(providerName)
    const titleConfig = {
      ...config,
      systemPrompt: ''
    }

    const provider = LLMFactory.createProvider(providerName, apiKey, titleConfig)

    const prompt = `Create a short session title (3-6 words) based on the assistant reply below.
Rules:
- Return ONLY the title
- No quotes
- No punctuation at the end
- Title case is optional
- Keep under 42 characters

Assistant reply:
${replyText}`

    let raw = ''
    await provider.streamResponse(prompt, null, [], (chunk) => {
      raw += chunk
    })

    let title = (raw || '').trim()
    title = title.replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').trim()
    title = title.replace(/\s+/g, ' ')
    title = title.replace(/[\.!?]+$/g, '').trim()

    const maxLen = 42
    if (title.length > maxLen) {
      title = title.slice(0, maxLen).trimEnd()
    }

    if (!title) {
      return { success: false, error: 'Failed to generate title' }
    }

    return { success: true, title }
  } catch (error) {
    console.error('Failed to generate session title:', error)
    return { success: false, error: error.message }
  }
})

// Config management IPC handlers
ipcMain.handle('save-api-key', async (_event, { provider, apiKey }) => {
  try {
    configService.setApiKey(provider, apiKey)
    console.log(`API key saved for provider: ${provider}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to save API key:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-api-key', async (_event, provider) => {
  try {
    const apiKey = configService.getApiKey(provider)
    return { success: true, apiKey }
  } catch (error) {
    console.error('Failed to get API key:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-active-provider', async (_event, provider) => {
  try {
    configService.setActiveProvider(provider)
    console.log(`Active provider set to: ${provider}`)

    broadcastConfigChanged()

    return { success: true }
  } catch (error) {
    console.error('Failed to set active provider:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-active-provider', async () => {
  try {
    const provider = configService.getActiveProvider()
    return { success: true, provider }
  } catch (error) {
    console.error('Failed to get active provider:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-provider-config', async (_event, provider) => {
  try {
    const config = configService.getProviderConfig(provider)
    return { success: true, config }
  } catch (error) {
    console.error('Failed to get provider config:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-provider-config', async (_event, { provider, config }) => {
  try {
    configService.setProviderConfig(provider, config)
    console.log(`Provider config saved for: ${provider}`)

    // Keep active-mode override in sync: last change wins.
    try {
      const activeModeId = configService.getActiveMode()
      const activeMode = configService.getMode(activeModeId)
      if (activeMode?.overrideProviderModel) {
        configService.saveMode({
          ...activeMode,
          provider,
          model: config?.model || ''
        })
      }
    } catch (e) {
      console.warn('Failed to sync active mode with provider config:', e?.message || e)
    }

    broadcastConfigChanged()

    return { success: true }
  } catch (error) {
    console.error('Failed to set provider config:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('validate-api-key', async (_event, provider) => {
  try {
    const apiKey = configService.getApiKey(provider)

    // Local providers don't require API key - skip validation
    if (isLocalProvider(provider)) {
      return { success: true, isValid: true }
    }

    if (!apiKey) {
      return { success: false, isValid: false, error: 'No API key configured' }
    }

    // OpenRouter-specific: use the dedicated key endpoint (reliable 401 on invalid keys).
    if (provider === 'openrouter') {
      try {
        const https = require('https')
        await new Promise((resolve, reject) => {
          const req = https.get(
            'https://openrouter.ai/api/v1/key',
            { headers: { Authorization: `Bearer ${apiKey}` } },
            (res) => {
              let data = ''
              res.on('data', (chunk) => { data += chunk })
              res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data)
                return reject(new Error(`HTTP ${res.statusCode}: ${data}`))
              })
            }
          )
          req.on('error', reject)
          req.setTimeout(10000, () => {
            req.destroy()
            reject(new Error('Request timeout'))
          })
        })
        return { success: true, isValid: true }
      } catch (err) {
        return { success: true, isValid: false, error: err.message }
      }
    }

    const config = configService.getProviderConfig(provider)
    const providerInstance = LLMFactory.createProvider(provider, apiKey, config)
    const isValid = await providerInstance.validateApiKey()

    return { success: true, isValid }
  } catch (error) {
    console.error('Failed to validate API key:', error)
    return { success: false, isValid: false, error: error.message }
  }
})

ipcMain.handle('get-displays', async () => {
  try {
    const { screen } = require('electron')
    const displays = screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      index,
      primary: display.bounds.x === 0 && display.bounds.y === 0,
      width: display.size.width,
      height: display.size.height,
      scaleFactor: display.scaleFactor
    }))

    console.log(`Found ${displays.length} displays`)
    return { success: true, displays }
  } catch (error) {
    console.error('Failed to get displays:', error)
    return { success: false, displays: [], error: error.message }
  }
})

// Mode management IPC handlers
ipcMain.handle('get-modes', async () => {
  try {
    const modes = configService.getModes()
    return { success: true, modes }
  } catch (error) {
    console.error('Failed to get modes:', error)
    return { success: false, modes: [], error: error.message }
  }
})

ipcMain.handle('save-mode', async (_event, mode) => {
  try {
    configService.saveMode(mode)
    console.log(`Mode saved: ${mode.name}`)

    // If the active mode overrides provider/model, it wins.
    try {
      const activeModeId = configService.getActiveMode()
      if (mode?.id === activeModeId && mode?.overrideProviderModel && mode?.provider) {
        configService.setActiveProvider(mode.provider)

        const existing = configService.getProviderConfig(mode.provider)
        const next = { ...existing }
        if (mode.model) next.model = mode.model
        configService.setProviderConfig(mode.provider, next)
      }
    } catch (e) {
      console.warn('Failed to sync provider config from mode override:', e?.message || e)
    }

    broadcastConfigChanged()

    return { success: true }
  } catch (error) {
    console.error('Failed to save mode:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('delete-mode', async (_event, modeId) => {
  try {
    configService.deleteMode(modeId)
    console.log(`Mode deleted: ${modeId}`)

    broadcastConfigChanged()

    return { success: true }
  } catch (error) {
    console.error('Failed to delete mode:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('reset-modes', async () => {
  try {
    configService.resetModesToDefault()
    console.log('All modes reset to defaults')
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config-changed')
    }
    
    return { success: true }
  } catch (error) {
    console.error('Failed to reset modes:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-default-modes', async () => {
  try {
    const modes = configService.getDefaultModes()
    return { success: true, modes }
  } catch (error) {
    console.error('Failed to get default modes:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-active-mode', async () => {
  try {
    const modeId = configService.getActiveMode()
    return { success: true, modeId }
  } catch (error) {
    console.error('Failed to get active mode:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-active-mode', async (_event, modeId) => {
  try {
    configService.setActiveMode(modeId)
    console.log(`Active mode set to: ${modeId}`)

    // If the mode overrides provider/model, it becomes the global selection.
    try {
      const mode = configService.getMode(modeId)
      if (mode?.overrideProviderModel && mode?.provider) {
        configService.setActiveProvider(mode.provider)

        const existing = configService.getProviderConfig(mode.provider)
        const next = { ...existing }
        if (mode.model) next.model = mode.model
        configService.setProviderConfig(mode.provider, next)
      }
    } catch (e) {
      console.warn('Failed to sync provider/model from active mode:', e?.message || e)
    }

    sendToWindows('active-mode-changed', modeId)
    broadcastConfigChanged()

    return { success: true }
  } catch (error) {
    console.error('Failed to set active mode:', error)
    return { success: false, error: error.message }
  }
})

// Open dashboard window (replaces standalone settings)
ipcMain.handle('open-settings', async () => {
  try {
    createDashboardWindow()
    return { success: true }
  } catch (error) {
    console.error('Failed to open dashboard:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('open-model-switcher', async () => {
  try {
    createModelSwitcherWindow()
    return { success: true }
  } catch (error) {
    console.error('Failed to open model switcher:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('close-model-switcher', async () => {
  try {
    if (modelSwitcherWindow && !modelSwitcherWindow.isDestroyed()) {
      modelSwitcherWindow.close()
    }
    return { success: true }
  } catch (error) {
    console.error('Failed to close model switcher:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('focus-overlay', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available' }
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    mainWindow.show()
    mainWindow.focus()
    return { success: true }
  } catch (error) {
    console.error('Failed to focus overlay:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('resume-session-in-overlay', async (_event, sessionId) => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available' }
    }

    // If the dashboard is open, get it out of the way
    // so the resumed chat replaces what the user sees.
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.hide()
    }

    mainWindow.webContents.send('resume-session', sessionId)
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
    return { success: true }
  } catch (error) {
    console.error('Failed to resume session in overlay:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('start-new-chat-in-overlay', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available' }
    }

    // If the dashboard is open, get it out of the way.
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.hide()
    }

    mainWindow.webContents.send('new-chat')
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
    return { success: true }
  } catch (error) {
    console.error('Failed to start new chat in overlay:', error)
    return { success: false, error: error.message }
  }
})

// Hide main window
ipcMain.handle('hide-window', async () => {
  if (mainWindow) {
    mainWindow.minimize()
  }
})

ipcMain.handle('dashboard-minimize', async () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.minimize()
  }
})

ipcMain.handle('dashboard-close', async () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close()
  }
})

// Collapse/expand overlay window so it doesn't block the screen
ipcMain.on('set-collapsed', (_event, payload) => {
  if (!mainWindow) return

  const collapsed = typeof payload === 'boolean' ? payload : !!payload?.collapsed
  const requestedHeight = typeof payload === 'object' && payload !== null ? payload.height : undefined

  const defaultCollapsedHeight = 136
  const collapsedHeight = Number.isFinite(requestedHeight)
    ? Math.max(110, Math.min(Math.round(requestedHeight), 400))
    : defaultCollapsedHeight

  if (collapsed) {
    // Save current bounds as expanded bounds before collapsing
    if (!overlayIsCollapsed) {
      overlayExpandedBounds = mainWindow.getBounds()
    }

    overlayIsCollapsed = true
    const currentBounds = mainWindow.getBounds()

    // Relax min height to allow collapse
    mainWindow.setMinimumSize(450, 100)

    // Use saved collapsed bounds if available, otherwise use current bounds with collapsed height
    let targetBounds
    if (overlayCollapsedBounds) {
      targetBounds = overlayCollapsedBounds
    } else {
      targetBounds = {
        x: currentBounds.x,
        y: currentBounds.y,
        width: currentBounds.width,
        height: collapsedHeight
      }
    }

    mainWindow.setBounds(targetBounds)
  } else {
    // Save current bounds as collapsed bounds before expanding
    if (overlayIsCollapsed) {
      overlayCollapsedBounds = mainWindow.getBounds()
    }

    overlayIsCollapsed = false

    // Restore expanded min height
    mainWindow.setMinimumSize(450, 400)

    // Use saved expanded bounds if available
    if (overlayExpandedBounds) {
      mainWindow.setBounds(overlayExpandedBounds)
    }
  }
})

let overlayTempBounds = null
ipcMain.handle('adjust-overlay-height', async (_event, extraHeight) => {
  if (!mainWindow) return { success: false, error: 'Overlay not available' }
  if (overlayIsCollapsed) return { success: false, error: 'Overlay is collapsed' }

  const extra = Number(extraHeight)
  if (!Number.isFinite(extra)) return { success: false, error: 'Invalid height' }

  // Store current bounds the first time we expand
  if (!overlayTempBounds) overlayTempBounds = mainWindow.getBounds()

  if (extra <= 0) {
    // Restore original bounds
    mainWindow.setBounds(overlayTempBounds)
    overlayTempBounds = null
    return { success: true }
  }

  const base = overlayTempBounds
  mainWindow.setBounds({
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height + Math.ceil(extra)
  })

  return { success: true }
})

// Memory settings IPC handlers
ipcMain.handle('get-memory-settings', async () => {
  try {
    const settings = configService.getMemorySettings()
    return { success: true, settings }
  } catch (error) {
    console.error('Failed to get memory settings:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-history-limit', async () => {
  try {
    const limit = configService.getHistoryLimit()
    return { success: true, limit }
  } catch (error) {
    console.error('Failed to get history limit:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-history-limit', async (_event, limit) => {
  try {
    configService.setHistoryLimit(limit)
    console.log(`History limit set to: ${limit}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to set history limit:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-summarization-enabled', async (_event, enabled) => {
  try {
    configService.setSummarizationEnabled(enabled)
    console.log(`Summarization enabled: ${enabled}`)
    return { success: true }
  } catch (error) {
    console.error('Failed to set summarization enabled:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-exclude-screenshots-from-memory', async () => {
  try {
    const exclude = configService.getExcludeScreenshotsFromMemory()
    return { success: true, exclude }
  } catch (error) {
    console.error('Failed to get exclude screenshots setting:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-exclude-screenshots-from-memory', async (_event, exclude) => {
  try {
    configService.setExcludeScreenshotsFromMemory(exclude)

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config-changed')
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to set exclude screenshots setting:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-screenshot-mode', async () => {
  try {
    const mode = configService.getScreenshotMode()
    return { success: true, mode }
  } catch (error) {
    console.error('Failed to get screenshot mode:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-screenshot-mode', async (_event, mode) => {
  try {
    configService.setScreenshotMode(mode)

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config-changed')
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to set screenshot mode:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-session-settings', async () => {
  try {
    const settings = configService.getSessionSettings()
    return { success: true, settings }
  } catch (error) {
    console.error('Failed to get session settings:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-auto-title-sessions', async (_event, enabled) => {
  try {
    configService.setAutoTitleSessions(enabled)

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config-changed')
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to set auto title sessions:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-start-collapsed', async () => {
  try {
    const startCollapsed = configService.getStartCollapsed()
    return { success: true, startCollapsed }
  } catch (error) {
    console.error('Failed to get start collapsed setting:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-start-collapsed', async (_event, startCollapsed) => {
  try {
    configService.setStartCollapsed(startCollapsed)

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config-changed')
    }

    return { success: true }
  } catch (error) {
    console.error('Failed to set start collapsed setting:', error)
    return { success: false, error: error.message }
  }
})

// Model refresh IPC handlers
ipcMain.handle('refresh-models', async (_event, providerId) => {
  try {
    const ModelRefreshService = require('../services/model-refresh')

    // Get API key for the provider
    const apiKey = configService.getApiKey(providerId)

    // Refresh models
    const result = await ModelRefreshService.refreshModels(providerId, apiKey)

    if (result.success) {
      console.log(`Successfully refreshed models for ${providerId}`)
      return { success: true, models: result.models }
    } else {
      console.error(`Failed to refresh models for ${providerId}:`, result.error)
      return { success: false, error: result.error }
    }
  } catch (error) {
    console.error('Error in refresh-models handler:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('check-model-cache-stale', async (_event, providerId) => {
  try {
    const ModelRefreshService = require('../services/model-refresh')
    const isStale = ModelRefreshService.isCacheStale(providerId)
    return { success: true, isStale }
  } catch (error) {
    console.error('Error checking cache staleness:', error)
    return { success: false, error: error.message }
  }
})

// Quit application
ipcMain.handle('quit-app', async () => {
  app.quit()
})

ipcMain.handle('open-data-folder', async () => {
  try {
    const { shell } = require('electron')
    const userDataPath = app.getPath('userData')
    await shell.openPath(userDataPath)
    return { success: true }
  } catch (error) {
    console.error('Failed to open data folder:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('open-external', async (_event, url) => {
  try {
    const { shell } = require('electron')
    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    console.error('Failed to open external URL:', error)
    return { success: false, error: error.message }
  }
})

// Load custom icons from directory
ipcMain.handle('load-custom-icons', async () => {
  try {
    // Prefer packaged renderer output if it contains the directory.
    // Fallback to the source tree path (packaged via electron-builder files).
    const candidates = [
      path.join(rendererPath, 'assets', 'icons', 'custom-icons'),
      path.join(__dirname, '../renderer/assets/icons/custom-icons')
    ]

    let iconsPath = null
    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate)
        if (stat && stat.isDirectory()) {
          iconsPath = candidate
          break
        }
      } catch {
        // ignore
      }
    }

    if (!iconsPath) {
      console.warn('Custom icons directory not found in any known location')
      return {}
    }

    const icons = {}

    // Read all files in custom-icons directory
    const files = await fs.readdir(iconsPath)

    // Filter for .svg files only
    const svgFiles = files.filter(file => file.endsWith('.svg'))

    console.log(`Loading ${svgFiles.length} custom icons from ${iconsPath}`)

    // Load each SVG file
    for (const file of svgFiles) {
      const filePath = path.join(iconsPath, file)
      const iconName = file.replace('.svg', '')
      const svgContent = await fs.readFile(filePath, 'utf-8')
      icons[iconName] = svgContent
    }

    console.log(`Loaded custom icons: ${Object.keys(icons).join(', ')}`)
    return icons
  } catch (error) {
    console.error('Failed to load custom icons:', error)
    return {}
  }
})

// New handlers for provider registry and config management
ipcMain.handle('get-all-providers-meta', async () => {
  try {
    const LLMFactory = require('../services/llm-factory')
    const providers = LLMFactory.getAllProvidersMeta()
    return { success: true, providers }
  } catch (error) {
    console.error('Failed to get provider metadata:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-configured-providers', async () => {
  try {
    if (!configService) {
      return { success: false, error: 'Config service not initialized' }
    }
    
    const providers = configService.getAllConfig().providers || {}
    const configured = {}
    
    // Return only providers that have API keys configured
    for (const [providerId, providerConfig] of Object.entries(providers)) {
      if (providerConfig.apiKey && providerConfig.apiKey.length > 0) {
        configured[providerId] = providerConfig
      }
    }
    
    return { success: true, providers: configured }
  } catch (error) {
    console.error('Failed to get configured providers:', error)
    return { success: false, error: error.message }
  }
})

// Session storage IPC handlers
ipcMain.handle('save-session', async (_event, session) => {
  try {
    if (!sessionStorage) {
      return { success: false, error: 'Session storage not initialized' }
    }

    const saved = await sessionStorage.saveSession(session)
    return { success: true, session: saved }
  } catch (error) {
    console.error('Failed to save session:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('load-session', async (_event, id) => {
  try {
    if (!sessionStorage) {
      return { success: false, error: 'Session storage not initialized' }
    }

    const session = await sessionStorage.loadSession(id)

    // Provide the most recent screenshot (if persisted) so the overlay can keep it sticky.
    try {
      const lastWithScreenshot = Array.isArray(session?.messages)
        ? [...session.messages].reverse().find(m => m?.type === 'user' && m?.hasScreenshot && typeof m?.screenshotPath === 'string' && m.screenshotPath)
        : null

      if (lastWithScreenshot) {
        const lastScreenshotBase64 = await sessionStorage.readScreenshotBase64(session.id || id, lastWithScreenshot.screenshotPath)
        if (lastScreenshotBase64) {
          session.lastScreenshotBase64 = lastScreenshotBase64
        }
      }
    } catch (e) {
      console.warn('Failed to load last screenshot:', e?.message || e)
    }

    return { success: true, session }
  } catch (error) {
    console.error('Failed to load session:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-screenshot', async (_event, { sessionId, screenshotPath }) => {
  try {
    if (!sessionStorage) {
      return { success: false, error: 'Session storage not initialized' }
    }

    const base64 = await sessionStorage.readScreenshotBase64(sessionId, screenshotPath)
    return { success: true, base64 }
  } catch (error) {
    console.error('Failed to get screenshot:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-all-sessions', async () => {
  try {
    if (!sessionStorage) {
      return { success: false, error: 'Session storage not initialized', sessions: [] }
    }

    const sessions = await sessionStorage.getAllSessions()
    return { success: true, sessions }
  } catch (error) {
    console.error('Failed to get all sessions:', error)
    return { success: false, error: error.message, sessions: [] }
  }
})

ipcMain.handle('delete-session', async (_event, id) => {
  try {
    if (!sessionStorage) {
      return { success: false, error: 'Session storage not initialized' }
    }

    await sessionStorage.deleteSession(id)

    // Ensure any in-memory state (e.g. sticky screenshots) is cleared in renderers.
    sendToWindows('session-deleted', id)

    return { success: true }
  } catch (error) {
    console.error('Failed to delete session:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('delete-all-data', async () => {
  try {
    if (!sessionStorage) {
      return { success: false, error: 'Session storage not initialized' }
    }

    // Delete all sessions (which also clears their screenshots).
    const sessions = await sessionStorage.getAllSessions()
    await Promise.all((sessions || []).map(async (s) => {
      try {
        await sessionStorage.deleteSession(s.id)
      } catch (e) {
        console.error('Failed to delete session during wipe:', s?.id, e)
      }
    }))

    // Notify renderers to reset local state.
    sendToWindows('session-deleted', null)

    return { success: true }
  } catch (error) {
    console.error('Failed to delete all data:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('rename-session', async (_event, { id, newTitle }) => {
  try {
    if (!sessionStorage) {
      return { success: false, error: 'Session storage not initialized' }
    }
    await sessionStorage.renameSession(id, newTitle)
    return { success: true }
  } catch (error) {
    console.error('Failed to rename session:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('toggle-session-saved', async (_event, id) => {
  try {
    if (!sessionStorage) {
      return { success: false, error: 'Session storage not initialized' }
    }
    const result = await sessionStorage.toggleSessionSaved(id)
    return { success: true, session: result }
  } catch (error) {
    console.error('Failed to toggle session saved:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-session-saved', async (_event, { id, isSaved }) => {
  try {
    if (!sessionStorage) {
      return { success: false, error: 'Session storage not initialized' }
    }
    const result = await sessionStorage.setSessionSaved(id, isSaved)
    return { success: true, session: result }
  } catch (error) {
    console.error('Failed to set session saved:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('show-session-context-menu', async (event, sessionId) => {
  const { Menu, BrowserWindow } = require('electron')
  
  // Check if session is saved
  let isSaved = false
  if (sessionStorage) {
    try {
      const session = await sessionStorage.loadSession(sessionId)
      isSaved = !!session?.isSaved
    } catch (e) {
      console.error('Error loading session for context menu:', e)
    }
  }

  return new Promise((resolve) => {
    const template = [
      {
        label: 'Rename',
        click: () => {
          event.sender.send('context-menu-command', { command: 'rename', sessionId })
        }
      },
      { type: 'separator' },
      {
        label: isSaved ? 'Unsave' : 'Save',
        click: () => {
          event.sender.send('context-menu-command', { command: 'save', sessionId })
        }
      }
    ]
    const menu = Menu.buildFromTemplate(template)
    // Find the window that sent the request to attach menu correctly
    const win = BrowserWindow.fromWebContents(event.sender)
    menu.popup({ window: win })
    resolve()
  })
})

ipcMain.handle('search-sessions', async (_event, query) => {
  try {
    if (!sessionStorage) {
      return { success: false, error: 'Session storage not initialized', sessions: [] }
    }

    const sessions = await sessionStorage.searchSessions(query)
    return { success: true, sessions }
  } catch (error) {
    console.error('Failed to search sessions:', error)
    return { success: false, error: error.message, sessions: [] }
  }
})

ipcMain.handle('get-app-version', (event) => {
  const senderUrl = event?.senderFrame?.url || ''
  if (!senderUrl.startsWith('file://') && !senderUrl.startsWith('http://localhost')) {
    throw new Error('Unauthorized IPC call')
  }

  return app.getVersion()
})

ipcMain.handle('check-for-updates', async () => {
  try {
    const https = require('https')
    const currentVersion = app.getVersion()

    return new Promise((resolve) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/MichaelT025/Shade/releases/latest',
        method: 'GET',
        headers: {
          'User-Agent': 'Shade-App',
          'Accept': 'application/vnd.github.v3+json'
        }
      }

      const req = https.request(options, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const release = JSON.parse(data)
              const latestVersion = release.tag_name.replace('v', '')

              // Simple version comparison (assumes semantic versioning)
              const currentParts = currentVersion.split('.').map(Number)
              const latestParts = latestVersion.split('.').map(Number)

              let updateAvailable = false
              for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
                const current = currentParts[i] || 0
                const latest = latestParts[i] || 0
                if (latest > current) {
                  updateAvailable = true
                  break
                } else if (current > latest) {
                  break
                }
              }

              resolve({
                updateAvailable,
                currentVersion,
                latestVersion,
                releaseNotes: release.body,
                downloadUrl: release.html_url
              })
            } else {
              resolve({
                updateAvailable: false,
                error: `GitHub API returned status ${res.statusCode}`
              })
            }
          } catch (error) {
            resolve({
              updateAvailable: false,
              error: 'Failed to parse GitHub response'
            })
          }
        })
      })

      req.on('error', (error) => {
        resolve({
          updateAvailable: false,
          error: `Network error: ${error.message}`
        })
      })

      req.setTimeout(10000, () => {
        req.destroy()
        resolve({
          updateAvailable: false,
          error: 'Request timeout'
        })
      })

      req.end()
    })
  } catch (error) {
    console.error('Failed to check for updates:', error)
    return {
      updateAvailable: false,
      error: error.message
    }
  }
})
