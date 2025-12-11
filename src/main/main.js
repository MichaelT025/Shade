const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs').promises
const { captureAndCompress } = require('../services/screen-capture')
const LLMFactory = require('../services/llm-factory')
const ConfigService = require('../services/config-service')

let mainWindow = null
let settingsWindow = null
let configService = null

// Create the main overlay window
function createMainWindow() {
  // Get primary display work area
  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { workArea } = primaryDisplay

  // Calculate position - right side but more centered vertically
  const width = 550
  const height = 500
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
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Allow window in system screenshots by default (PrtSc, etc.)
  // Content protection will be enabled temporarily during app screenshot capture
  mainWindow.setContentProtection(false)

  // Load the renderer
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  // Open DevTools for debugging (disabled for production)
  // mainWindow.webContents.openDevTools()

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
    modal: false,
    show: false,
    alwaysOnTop: false,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Load settings.html
  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'))

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

ipcMain.handle('send-message', async (event, { text, imageBase64, conversationHistory }) => {
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

    // Get provider configuration and merge with active mode's system prompt
    const config = configService.getProviderConfig(providerName)
    const activeSystemPrompt = configService.getActiveSystemPrompt()

    // Merge system prompt from active mode into config
    const configWithPrompt = {
      ...config,
      systemPrompt: activeSystemPrompt
    }

    // Create provider instance
    const provider = LLMFactory.createProvider(providerName, apiKey, configWithPrompt)

    // Stream response chunks to renderer
    await provider.streamResponse(text, imageBase64, conversationHistory || [], (chunk) => {
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

    // Notify main window that config changed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config-changed')
    }

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

    // Notify main window that config changed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config-changed')
    }

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
    return { success: true }
  } catch (error) {
    console.error('Failed to delete mode:', error)
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
    return { success: true }
  } catch (error) {
    console.error('Failed to set active mode:', error)
    return { success: false, error: error.message }
  }
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

// Hide main window
ipcMain.handle('hide-window', async () => {
  if (mainWindow) {
    mainWindow.hide()
  }
})

// Quit application
ipcMain.handle('quit-app', async () => {
  app.quit()
})

// Load custom icons from directory
ipcMain.handle('load-custom-icons', async () => {
  try {
    const iconsPath = path.join(__dirname, '../renderer/assets/icons/custom-icons')
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
