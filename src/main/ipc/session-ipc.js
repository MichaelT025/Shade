const { ipcMain, Menu, BrowserWindow } = require('electron')

function registerSessionIpcHandlers({ sessionStorage, sendToWindows }) {
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

      const sessions = await sessionStorage.getAllSessions()
      await Promise.all((sessions || []).map(async (s) => {
        try {
          await sessionStorage.deleteSession(s.id)
        } catch (e) {
          console.error('Failed to delete session during wipe:', s?.id, e)
        }
      }))

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
}

module.exports = {
  registerSessionIpcHandlers
}
