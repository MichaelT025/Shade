const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, dialog } = require('electron')
const path = require('path')

// Improve transparent window rendering stability on Windows
// Prevents GPU surface recreation flicker when showing/hiding overlay
app.commandLine.appendSwitch('enable-features', 'CalculateNativeWinOcclusion')
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

// Track overlay-specific shortcuts that should only work when overlay is visible
const overlayShortcuts = new Map()

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
function showMainWindow(source = 'unknown') {
  windowManager?.showMainWindow(source)
}

// Hide main window to tray
function hideMainWindow(source = 'unknown') {
  windowManager?.hideMainWindow(source)
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
        showMainWindow('tray-menu-show')
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
    showMainWindow('tray-click')
  })
}

// Register overlay-specific shortcuts (only active when overlay is visible)
function registerOverlayShortcuts() {
  // Ctrl+R to start new chat
  if (!overlayShortcuts.has('CommandOrControl+R')) {
    const success = globalShortcut.register('CommandOrControl+R', () => {
      const mainWindow = windowManager?.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('new-chat')
      }
    })
    if (success) overlayShortcuts.set('CommandOrControl+R', true)
  }

  // Ctrl+' to toggle overlay collapse
  if (!overlayShortcuts.has('CommandOrControl+\'')) {
    const success = globalShortcut.register('CommandOrControl+\'', () => {
      const mainWindow = windowManager?.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('toggle-collapse')
      }
    })
    if (success) overlayShortcuts.set('CommandOrControl+\'', true)
  }

  // Ctrl+Shift+S to capture screenshot
  if (!overlayShortcuts.has('CommandOrControl+Shift+S')) {
    const success = globalShortcut.register('CommandOrControl+Shift+S', () => {
      const mainWindow = windowManager?.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('capture-screenshot')
      }
    })
    if (success) overlayShortcuts.set('CommandOrControl+Shift+S', true)
  }

  // Ctrl+M to open model switcher
  const modelSwitcherShortcut = process.platform === 'darwin'
    ? 'CommandOrControl+Shift+M'
    : 'CommandOrControl+M'
  if (!overlayShortcuts.has(modelSwitcherShortcut)) {
    const success = globalShortcut.register(modelSwitcherShortcut, () => {
      windowManager?.toggleModelSwitcherWindow()
    })
    if (success) overlayShortcuts.set(modelSwitcherShortcut, true)
  }
}

// Unregister overlay-specific shortcuts (call when overlay is hidden)
function unregisterOverlayShortcuts() {
  for (const shortcut of overlayShortcuts.keys()) {
    globalShortcut.unregister(shortcut)
  }
  overlayShortcuts.clear()
}

// Register global hotkeys (always active)
function registerHotkeys() {
  const registrationFailures = []

  // Ctrl+/ to toggle window visibility (hide to tray / show) - always registered
  const toggleSuccess = globalShortcut.register('CommandOrControl+/', () => {
    const mainWindow = windowManager?.getMainWindow()
    if (mainWindow) {
      if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
        showMainWindow('hotkey-ctrl-slash')
      } else {
        hideMainWindow('hotkey-ctrl-slash')
      }
    }
  })
  if (!toggleSuccess) {
    registrationFailures.push(`Toggle overlay visibility (CommandOrControl+/)`)
  }

  // Overlay-specific shortcuts will be registered when overlay becomes visible
  // via showMainWindow -> registerOverlayShortcuts

  if (registrationFailures.length > 0) {
    console.warn('Global shortcut registration failed for:', registrationFailures)
    const message = `Some keyboard shortcuts could not be registered:\n\n${registrationFailures.join('\n')}\n\nThese may be reserved by the OS or another app.`
    dialog.showMessageBox({
      type: 'warning',
      title: 'Shortcut Registration Warning',
      message,
      buttons: ['OK']
    }).catch(() => {
      // best-effort user warning
    })
  }
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
    getIconPath,
    configService,
    onOverlayShow: registerOverlayShortcuts,
    onOverlayHide: unregisterOverlayShortcuts
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
    broadcastConfigChanged,
    getMainWindow: () => windowManager?.getMainWindow()
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
