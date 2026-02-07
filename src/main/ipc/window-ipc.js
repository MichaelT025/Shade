const { ipcMain } = require('electron')

function registerWindowIpcHandlers(windowManager) {
  ipcMain.handle('open-settings', async () => {
    try {
      windowManager.createDashboardWindow()
      return { success: true }
    } catch (error) {
      console.error('Failed to open dashboard:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('close-model-switcher', async () => {
    try {
      windowManager.closeModelSwitcherWindow()
      return { success: true }
    } catch (error) {
      console.error('Failed to close model switcher:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('resume-session-in-overlay', async (_event, sessionId) => {
    try {
      return windowManager.resumeSessionInOverlay(sessionId)
    } catch (error) {
      console.error('Failed to resume session in overlay:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('start-new-chat-in-overlay', async () => {
    try {
      return windowManager.startNewChatInOverlay()
    } catch (error) {
      console.error('Failed to start new chat in overlay:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('hide-window', async () => {
    windowManager.hideMainWindow()
  })

  ipcMain.handle('dashboard-minimize', async () => {
    const win = windowManager.getSettingsWindow()
    if (win && !win.isDestroyed()) {
      win.minimize()
    }
  })

  ipcMain.handle('dashboard-close', async () => {
    const win = windowManager.getSettingsWindow()
    if (win && !win.isDestroyed()) {
      win.close()
    }
  })

  ipcMain.on('set-collapsed', (_event, payload) => {
    windowManager.setCollapsed(payload)
  })
}

module.exports = {
  registerWindowIpcHandlers
}
