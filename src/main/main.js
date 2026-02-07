const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const LLMFactory = require('../services/llm-factory')
const ConfigService = require('../services/config-service')
const SessionStorage = require('../services/session-storage')
const { createWindowManager } = require('./windows/window-manager')
const { registerWindowIpcHandlers } = require('./ipc/window-ipc')
const { createChatIpcRegistrar } = require('./ipc/chat-ipc')
const { registerConfigIpcHandlers } = require('./ipc/config-ipc')
const { registerSessionIpcHandlers } = require('./ipc/session-ipc')
const { registerSystemIpcHandlers } = require('./ipc/system-ipc')
const { createUpdateService } = require('./services/update-service')

let tray = null
let configService = null
let sessionStorage = null
let windowManager = null
let updateService = null

function sendToWindows(channel, ...args) {
  windowManager?.sendToWindows(channel, ...args)
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

// Show main window (from tray or shortcut)
function showMainWindow() {
  windowManager?.showMainWindow()
}

// Hide main window to tray
function hideMainWindow() {
  windowManager?.hideMainWindow()
}

// Create system tray with context menu
function createTray() {
  const iconPath = getIconPath()
  const icon = nativeImage.createFromPath(iconPath)
  
  tray = new Tray(icon)
  tray.setToolTip('Shade')
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show',
      click: () => {
        showMainWindow()
      }
    },
    {
      label: 'Open Dashboard',
      click: () => {
        windowManager?.createDashboardWindow()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      }
    }
  ])
  
  tray.setContextMenu(contextMenu)
  
  // Left-click on tray shows the main window
  tray.on('click', () => {
    showMainWindow()
  })
}

// Register global hotkeys
function registerHotkeys() {
  const isOverlayVisible = () => {
    const mainWindow = windowManager?.getMainWindow()
    if (!mainWindow) return false
    // Treat minimized/hidden as "overlay hidden" for shortcut gating.
    if (mainWindow.isMinimized()) return false
    if (!mainWindow.isVisible()) return false
    return true
  }

  // Ctrl+/ to toggle window visibility (hide to tray / show)
  globalShortcut.register('CommandOrControl+/', () => {
    const mainWindow = windowManager?.getMainWindow()
    if (mainWindow) {
      if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
        showMainWindow()
      } else {
        hideMainWindow()
      }
    }
  })

  // Ctrl+R to start new chat
  globalShortcut.register('CommandOrControl+R', () => {
    const mainWindow = windowManager?.getMainWindow()
    if (!isOverlayVisible()) return
    mainWindow.webContents.send('new-chat')
  })

  // Ctrl+' to toggle overlay collapse
  globalShortcut.register('CommandOrControl+\'', () => {
    const mainWindow = windowManager?.getMainWindow()
    if (!isOverlayVisible()) return
    mainWindow.webContents.send('toggle-collapse')
  })

  // Ctrl+Shift+S to capture screenshot
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    const mainWindow = windowManager?.getMainWindow()
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
    windowManager?.toggleModelSwitcherWindow()
  })
}

// App lifecycle events
app.whenReady().then(() => {
  // Initialize config service with user data path
  const userDataPath = app.getPath('userData')
  configService = new ConfigService(userDataPath)
  sessionStorage = new SessionStorage(userDataPath)
  updateService = createUpdateService({
    configService,
    sendToWindows
  })

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

  windowManager = createWindowManager({
    rendererPath,
    getIconPath
  })

  windowManager.createMainWindow()
  createTray()
  registerHotkeys()

  registerWindowIpcHandlers(windowManager)
  createChatIpcRegistrar({
    configService,
    getMainWindow: () => windowManager?.getMainWindow()
  }).registerChatIpcHandlers()

  registerConfigIpcHandlers({
    configService,
    updateService,
    sendToWindows,
    broadcastConfigChanged
  })

  registerSessionIpcHandlers({
    sessionStorage,
    sendToWindows
  })

  registerSystemIpcHandlers({
    rendererPath,
    updateService
  })

  updateService.init()

  // On macOS it's common to re-create a window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager?.createMainWindow()
    }
  })
})

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Unregister shortcuts and destroy tray when app quits
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (tray) {
    tray.destroy()
    tray = null
  }
})

// IPC handlers are registered from ./ipc/* modules during app bootstrap.
