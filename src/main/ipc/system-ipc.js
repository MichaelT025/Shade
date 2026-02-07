const { ipcMain, app, shell } = require('electron')
const path = require('path')
const fs = require('fs').promises

function registerSystemIpcHandlers({ rendererPath, updateService }) {
  ipcMain.handle('quit-app', async () => {
    app.quit()
  })

  ipcMain.handle('open-data-folder', async () => {
    try {
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
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Only http and https URLs are allowed' }
      }
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error('Failed to open external URL:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('load-custom-icons', async () => {
    try {
      const candidates = [
        path.join(rendererPath, 'assets', 'icons', 'custom-icons'),
        path.join(__dirname, '../../renderer/assets/icons/custom-icons')
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
      const files = await fs.readdir(iconsPath)
      const svgFiles = files.filter(file => file.endsWith('.svg'))

      console.log(`Loading ${svgFiles.length} custom icons from ${iconsPath}`)

      for (const file of svgFiles) {
        const filePath = path.join(iconsPath, file)
        const iconName = file.replace(/\.svg$/i, '').toLowerCase()
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

  ipcMain.handle('get-app-version', (event) => {
    const senderUrl = event?.senderFrame?.url || ''
    if (!senderUrl.startsWith('file://') && !senderUrl.startsWith('http://localhost')) {
      throw new Error('Unauthorized IPC call')
    }

    return app.getVersion()
  })

  ipcMain.handle('check-for-updates', async () => {
    try {
      if (!updateService) {
        return {
          success: false,
          updateAvailable: false,
          error: 'Update service is unavailable'
        }
      }

      return await updateService.checkForUpdates({ manual: true })
    } catch (error) {
      console.error('Failed to check for updates:', error)
      return {
        success: false,
        updateAvailable: false,
        error: error.message
      }
    }
  })

  ipcMain.handle('download-update', async () => {
    try {
      if (!updateService) {
        return { success: false, error: 'Update service is unavailable' }
      }
      return await updateService.downloadUpdate()
    } catch (error) {
      console.error('Failed to download update:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('quit-and-install-update', async () => {
    try {
      if (!updateService) {
        return { success: false, error: 'Update service is unavailable' }
      }
      return updateService.quitAndInstall()
    } catch (error) {
      console.error('Failed to quit and install update:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-update-status', () => {
    if (!updateService) {
      return { success: false, status: 'unsupported', error: 'Update service is unavailable' }
    }
    return { success: true, ...updateService.getStatus() }
  })
}

module.exports = {
  registerSystemIpcHandlers
}
