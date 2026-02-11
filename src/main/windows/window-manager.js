const { BrowserWindow, screen, shell, ipcMain } = require('electron')
const path = require('path')

function isAllowedInternalUrl(url) {
  return url.startsWith('file://') || url.startsWith('http://localhost')
}

function attachNavigationGuards(win) {
  if (!win || !win.webContents) return

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url)
      }
    } catch {
      // ignore malformed urls
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedInternalUrl(url)) {
      event.preventDefault()
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          shell.openExternal(url)
        }
      } catch {
        // ignore malformed urls
      }
    }
  })
}

function createWindowManager({ rendererPath, getIconPath, configService, onOverlayShow, onOverlayHide }) {
  let mainWindow = null
  let settingsWindow = null
  let modelSwitcherWindow = null

  let overlayExpandedBounds = null
  let overlayCollapsedBounds = null
  let overlayIsCollapsed = false

  let focusTimer = null

  function logMainWindowVisibility(action, source, details = {}) {
    const payload = {
      action,
      source,
      at: Date.now(),
      ...details
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      console.log('[Shade visibility]', {
        ...payload,
        visible: false,
        minimized: false,
        overlayIsCollapsed,
        bounds: null,
        windowState: 'missing'
      })
      return
    }

    console.log('[Shade visibility]', {
      ...payload,
      visible: mainWindow.isVisible(),
      minimized: mainWindow.isMinimized(),
      overlayIsCollapsed,
      bounds: mainWindow.getBounds()
    })
  }

  function boundsDiffer(a, b) {
    if (!a || !b) return false
    return (
      a.x !== b.x ||
      a.y !== b.y ||
      a.width !== b.width ||
      a.height !== b.height
    )
  }

  function applyPreferredBoundsBeforeShow(source) {
    if (!mainWindow || mainWindow.isDestroyed()) return

    const preferredBounds = overlayIsCollapsed ? overlayCollapsedBounds : overlayExpandedBounds
    if (!preferredBounds) return

    const currentBounds = mainWindow.getBounds()
    if (!boundsDiffer(currentBounds, preferredBounds)) return

    mainWindow.setBounds(preferredBounds)
    logMainWindowVisibility('pre-show-bounds-applied', source, { preferredBounds })
  }

  function showAndFocusMainWindow(source = 'unknown') {
    if (!mainWindow || mainWindow.isDestroyed()) return false

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }

    // Clear any stale focus timer before scheduling a new one
    if (focusTimer) {
      clearTimeout(focusTimer)
      focusTimer = null
    }

    applyPreferredBoundsBeforeShow(source)
    
    // Workaround for transparent window flicker on Windows:
    // Briefly set opacity to 0 before showing, then fade in
    mainWindow.setOpacity(0)
    mainWindow.showInactive()
    mainWindow.focus()
    
    // Small delay to let the compositor settle, then fade in
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setOpacity(1)
      }
    }, 16)

    mainWindow.webContents.send('window-shown')
    logMainWindowVisibility('show-request', source)
    return true
  }

  function getMainWindow() {
    return mainWindow
  }

  function getSettingsWindow() {
    return settingsWindow
  }

  function getModelSwitcherWindow() {
    return modelSwitcherWindow
  }

  function sendToWindows(channel, ...args) {
    ;[mainWindow, settingsWindow, modelSwitcherWindow].forEach((win) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    })
  }

  function createMainWindow() {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay

    const width = 500
    const height = 450
    const paddingRight = 100
    const paddingTop = 80

    const x = workArea.x + workArea.width - width - paddingRight
    const y = workArea.y + paddingTop

    mainWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      show: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      resizable: true,
      skipTaskbar: true,
      minWidth: 450,
      minHeight: 400,
      maxWidth: 1000,
      maxHeight: 1000,
      backgroundColor: '#00000000',
      icon: getIconPath(),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js')
      }
    })

    attachNavigationGuards(mainWindow)

    overlayExpandedBounds = mainWindow.getBounds()

    // Apply content protection from config (when enabled, overlay is always
    // excluded from screenshots — no per-show/hide toggling needed).
    const excludeFromScreenshots = configService
      ? configService.getExcludeOverlayFromScreenshots()
      : false
    mainWindow.setContentProtection(!!excludeFromScreenshots)

    mainWindow.loadFile(path.join(rendererPath, 'index.html'))

    // Wait for the renderer to finish init() and report its desired size
    // before showing, so the user never sees a partially-initialized or
    // mis-sized window.
    const onRendererReady = (_event, payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) return

      // If the renderer wants to start collapsed, apply the size before showing.
      if (payload && payload.collapsed && typeof payload.height === 'number') {
        overlayIsCollapsed = true
        const bounds = mainWindow.getBounds()
        mainWindow.setMinimumSize(450, 100)
        mainWindow.setBounds({ ...bounds, height: payload.height })
      }

      showAndFocusMainWindow('initial-renderer-ready')
    }

    ipcMain.once('renderer-ready', onRendererReady)

    // Safety timeout — if the renderer never reports ready (e.g. crash),
    // show the window after 4 seconds so it doesn't stay invisible forever.
    const readyTimeout = setTimeout(() => {
      ipcMain.removeListener('renderer-ready', onRendererReady)
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        showAndFocusMainWindow('initial-ready-timeout')
      }
    }, 4000)

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

    mainWindow.on('minimize', (event) => {
      event.preventDefault()
      logMainWindowVisibility('minimize-intercept-hide', 'minimize-event')
      mainWindow.hide()
    })

    mainWindow.on('show', () => {
      logMainWindowVisibility('event-show', 'electron-event')
    })

    mainWindow.on('hide', () => {
      if (focusTimer) {
        clearTimeout(focusTimer)
        focusTimer = null
      }
      logMainWindowVisibility('event-hide', 'electron-event')
    })

    mainWindow.on('closed', () => {
      if (focusTimer) {
        clearTimeout(focusTimer)
        focusTimer = null
      }
      clearTimeout(readyTimeout)
      mainWindow = null
    })
  }

  function createDashboardWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      if (settingsWindow.isMinimized()) {
        settingsWindow.restore()
      }
      settingsWindow.show()
      settingsWindow.focus()
      return
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay

    const dashboardWidth = 980
    const dashboardHeight = 720

    const overlayWidth = 500
    const overlayPaddingRight = 100
    const gapBetweenWindows = 60

    const overlayLeft = workArea.x + workArea.width - overlayWidth - overlayPaddingRight
    let dashboardX = overlayLeft - gapBetweenWindows - dashboardWidth

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
        preload: path.join(__dirname, '../preload.js')
      }
    })

    attachNavigationGuards(settingsWindow)
    settingsWindow.loadFile(path.join(rendererPath, 'homepage.html'))

    settingsWindow.once('ready-to-show', () => {
      settingsWindow.show()
    })

    settingsWindow.on('closed', () => {
      settingsWindow = null
    })
  }

  function toggleModelSwitcherWindow() {
    if (modelSwitcherWindow && !modelSwitcherWindow.isDestroyed()) {
      if (modelSwitcherWindow.isVisible()) {
        modelSwitcherWindow.close()
        return
      }
      if (modelSwitcherWindow.isMinimized()) {
        modelSwitcherWindow.restore()
      }
      modelSwitcherWindow.show()
      modelSwitcherWindow.focus()
      return
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay

    const width = 520
    const height = 640

    let x = workArea.x + Math.round((workArea.width - width) / 2)
    let y = workArea.y + Math.round((workArea.height - height) / 3)

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
        preload: path.join(__dirname, '../preload.js')
      }
    })

    attachNavigationGuards(modelSwitcherWindow)
    modelSwitcherWindow.loadFile(path.join(rendererPath, 'model-switcher.html'))

    modelSwitcherWindow.once('ready-to-show', () => {
      modelSwitcherWindow.show()
      modelSwitcherWindow.focus()
    })

    modelSwitcherWindow.on('blur', () => {
      if (modelSwitcherWindow && !modelSwitcherWindow.isDestroyed()) {
        modelSwitcherWindow.close()
      }
    })

    modelSwitcherWindow.on('closed', () => {
      modelSwitcherWindow = null
    })
  }

  function closeModelSwitcherWindow() {
    if (modelSwitcherWindow && !modelSwitcherWindow.isDestroyed()) {
      modelSwitcherWindow.close()
    }
  }

  function showMainWindow(source = 'unknown') {
    if (!mainWindow || mainWindow.isDestroyed()) return
    showAndFocusMainWindow(source)
    // Notify main process to register overlay-specific shortcuts
    if (onOverlayShow) onOverlayShow()
  }

  function hideMainWindow(source = 'unknown') {
    if (!mainWindow || mainWindow.isDestroyed()) return

    // Cancel any pending deferred focus to avoid race on quick hide/show
    if (focusTimer) {
      clearTimeout(focusTimer)
      focusTimer = null
    }

    // Notify renderer that window is about to hide so it can clean up visual state
    mainWindow.webContents.send('window-hidden')

    logMainWindowVisibility('hide-request', source)
    mainWindow.hide()
    // Notify main process to unregister overlay-specific shortcuts
    if (onOverlayHide) onOverlayHide()
  }

  function resumeSessionInOverlay(sessionId) {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available' }
    }

    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.hide()
    }

    mainWindow.webContents.send('resume-session', sessionId)
    showAndFocusMainWindow('resume-session')
    return { success: true }
  }

  function startNewChatInOverlay() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available' }
    }

    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.hide()
    }

    mainWindow.webContents.send('new-chat')
    showAndFocusMainWindow('new-chat-overlay')
    return { success: true }
  }

  function setCollapsed(payload) {
    if (!mainWindow) return

    const collapsed = typeof payload === 'boolean' ? payload : !!payload?.collapsed
    const requestedHeight = typeof payload === 'object' && payload !== null ? payload.height : undefined

    const defaultCollapsedHeight = 136
    const collapsedHeight = Number.isFinite(requestedHeight)
      ? Math.max(110, Math.min(Math.round(requestedHeight), 400))
      : defaultCollapsedHeight

    if (collapsed) {
      if (!overlayIsCollapsed) {
        overlayExpandedBounds = mainWindow.getBounds()
      }

      overlayIsCollapsed = true
      const currentBounds = mainWindow.getBounds()
      mainWindow.setMinimumSize(450, 100)

      let targetBounds
      if (overlayCollapsedBounds) {
        targetBounds = {
          ...overlayCollapsedBounds,
          height: collapsedHeight
        }
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
      if (overlayIsCollapsed) {
        overlayCollapsedBounds = mainWindow.getBounds()
      }

      overlayIsCollapsed = false
      mainWindow.setMinimumSize(450, 400)

      if (overlayExpandedBounds) {
        mainWindow.setBounds(overlayExpandedBounds)
      }
    }
  }

  return {
    getMainWindow,
    getSettingsWindow,
    getModelSwitcherWindow,
    sendToWindows,
    createMainWindow,
    createDashboardWindow,
    toggleModelSwitcherWindow,
    closeModelSwitcherWindow,
    showMainWindow,
    hideMainWindow,
    resumeSessionInOverlay,
    startNewChatInOverlay,
    setCollapsed
  }
}

module.exports = {
  createWindowManager
}
