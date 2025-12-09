const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const path = require('path')
const { captureAndCompress } = require('../services/screen-capture')
const LLMFactory = require('../services/llm-factory')
const ConfigService = require('../services/config-service')

let mainWindow = null
let settingsWindow = null
let configService = null

// Create the main overlay window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 550,
    height: 500,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Exclude this window from screen capture (Windows 10 v2004+)
  mainWindow.setContentProtection(true)

  // Load the renderer
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  // Open DevTools for debugging
  mainWindow.webContents.openDevTools()

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Create the settings window
function createSettingsWindow() {
  // Don't create if already exists
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 700,
    parent: mainWindow,
    modal: false,
    show: false,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // TODO: Create settings.html for settings UI
  // For now, load a placeholder
  settingsWindow.loadURL('data:text/html,<html><body style="background:#1a1a1a;color:white;font-family:sans-serif;padding:20px;"><h1>Settings</h1><p>Settings panel coming soon...</p><p>API keys, providers, and system prompts will be configured here.</p></body></html>')

  // Show when ready
  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show()
  })

  // Handle window closed
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

// Register global hotkeys
function registerHotkeys() {
  // Ctrl+/ to toggle window visibility
  globalShortcut.register('CommandOrControl+/', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })

  // Ctrl+R to start new chat
  globalShortcut.register('CommandOrControl+R', () => {
    if (mainWindow) {
      mainWindow.webContents.send('new-chat')
    }
  })
}

// App lifecycle events
app.whenReady().then(() => {
  // Initialize config service with user data path
  const userDataPath = app.getPath('userData')
  configService = new ConfigService(userDataPath)

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

    // Capture and compress the screenshot
    // The overlay is automatically excluded via setContentProtection(true)
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
  }
})

ipcMain.handle('send-message', async (event, { text, imageBase64 }) => {
  try {
    console.log('Message send requested:', text)

    // Get active provider and API key
    const providerName = configService.getActiveProvider()
    const apiKey = configService.getApiKey(providerName)

    if (!apiKey) {
      return {
        success: false,
        error: `No API key configured for ${providerName}. Please add your API key in settings.`
      }
    }

    // Get provider configuration
    const config = configService.getProviderConfig(providerName)

    // Create provider instance
    const provider = LLMFactory.createProvider(providerName, apiKey, config)

    // Stream response chunks to renderer
    await provider.streamResponse(text, imageBase64, (chunk) => {
      event.sender.send('message-chunk', chunk)
    })

    // Signal completion
    event.sender.send('message-complete')

    console.log('Response streaming completed')

    return {
      success: true,
      provider: providerName
    }
  } catch (error) {
    console.error('Failed to send message:', error)

    // Send error to renderer
    event.sender.send('message-error', error.message)

    return {
      success: false,
      error: error.message
    }
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
    return { success: true }
  } catch (error) {
    console.error('Failed to set provider config:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('validate-api-key', async (_event, provider) => {
  try {
    const apiKey = configService.getApiKey(provider)
    if (!apiKey) {
      return { success: false, valid: false, error: 'No API key configured' }
    }

    const config = configService.getProviderConfig(provider)
    const providerInstance = LLMFactory.createProvider(provider, apiKey, config)
    const isValid = await providerInstance.validateApiKey()

    return { success: true, valid: isValid }
  } catch (error) {
    console.error('Failed to validate API key:', error)
    return { success: false, valid: false, error: error.message }
  }
})

ipcMain.handle('get-displays', async () => {
  // TODO: Implement display detection
  console.log('Get displays requested')
  return { success: true, displays: [] }
})

// Open settings window
ipcMain.handle('open-settings', async () => {
  try {
    createSettingsWindow()
    return { success: true }
  } catch (error) {
    console.error('Failed to open settings:', error)
    return { success: false, error: error.message }
  }
})

// Quit application
ipcMain.handle('quit-app', async () => {
  app.quit()
})
