const { app } = require('electron')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log')

const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000
const AUTO_UPDATE_STARTUP_DELAY_MS = 15000

function createUpdateService({ configService, sendToWindows }) {
  let initialized = false
  let autoCheckTimer = null

  let state = {
    status: 'idle',
    updateAvailable: false,
    updateReady: false,
    version: '',
    percent: 0,
    error: ''
  }

  function broadcast(payload) {
    state = {
      ...state,
      ...payload
    }
    sendToWindows('update-status', state)
  }

  function clearAutoCheckTimer() {
    if (autoCheckTimer) {
      clearInterval(autoCheckTimer)
      autoCheckTimer = null
    }
  }

  function isUpdateSupported() {
    return app.isPackaged
  }

  function scheduleAutomaticChecks() {
    clearAutoCheckTimer()

    if (!isUpdateSupported()) return
    if (!configService.getAutoUpdateEnabled()) return

    setTimeout(() => {
      checkForUpdates({ manual: false }).catch(error => {
        log.error('Startup auto-update check failed:', error)
      })
    }, AUTO_UPDATE_STARTUP_DELAY_MS)

    autoCheckTimer = setInterval(() => {
      checkForUpdates({ manual: false }).catch(error => {
        log.error('Scheduled auto-update check failed:', error)
      })
    }, AUTO_UPDATE_INTERVAL_MS)
  }

  function wireEvents() {
    autoUpdater.logger = log
    autoUpdater.logger.transports.file.level = 'info'
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.autoDownload = configService.getAutoUpdateEnabled()

    autoUpdater.on('checking-for-update', () => {
      broadcast({
        status: 'checking',
        error: '',
        percent: 0
      })
    })

    autoUpdater.on('update-available', (info) => {
      broadcast({
        status: 'available',
        updateAvailable: true,
        version: info?.version || '',
        error: '',
        percent: 0
      })
    })

    autoUpdater.on('update-not-available', () => {
      broadcast({
        status: 'up-to-date',
        updateAvailable: false,
        updateReady: false,
        version: '',
        error: '',
        percent: 0
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      broadcast({
        status: 'downloading',
        updateAvailable: true,
        percent: Math.max(0, Math.min(100, Number(progress?.percent || 0))),
        error: ''
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      broadcast({
        status: 'downloaded',
        updateAvailable: true,
        updateReady: true,
        version: info?.version || state.version || '',
        percent: 100,
        error: ''
      })
    })

    autoUpdater.on('error', (error) => {
      const message = error?.message || String(error || 'Unknown update error')
      log.error('Auto updater error:', message)
      broadcast({
        status: 'error',
        error: message
      })
    })
  }

  function init() {
    if (initialized) return
    initialized = true

    if (!isUpdateSupported()) {
      state = {
        ...state,
        status: 'unsupported'
      }
      return
    }

    wireEvents()
    scheduleAutomaticChecks()
  }

  async function checkForUpdates({ manual = false } = {}) {
    if (!isUpdateSupported()) {
      return {
        success: false,
        updateAvailable: false,
        status: 'unsupported',
        error: 'Auto-updates are only available in packaged builds.'
      }
    }

    try {
      await autoUpdater.checkForUpdates()

      const updateAvailable = state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded'
      const version = state.version || ''

      return {
        success: true,
        updateAvailable,
        version,
        status: state.status
      }
    } catch (error) {
      const message = error?.message || String(error)
      log.error('checkForUpdates failed:', message)
      broadcast({
        status: 'error',
        error: message
      })
      return {
        success: false,
        updateAvailable: false,
        status: 'error',
        error: message
      }
    }
  }

  async function downloadUpdate() {
    if (!isUpdateSupported()) {
      return { success: false, error: 'Auto-updates are only available in packaged builds.' }
    }

    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      const message = error?.message || String(error)
      return { success: false, error: message }
    }
  }

  function quitAndInstall() {
    if (!isUpdateSupported()) {
      return { success: false, error: 'Auto-updates are only available in packaged builds.' }
    }

    autoUpdater.quitAndInstall(false, true)
    return { success: true }
  }

  function setAutoUpdateEnabled(enabled) {
    configService.setAutoUpdateEnabled(enabled)
    autoUpdater.autoDownload = configService.getAutoUpdateEnabled()
    scheduleAutomaticChecks()
    return { success: true }
  }

  function getStatus() {
    return {
      ...state,
      autoUpdateEnabled: configService.getAutoUpdateEnabled()
    }
  }

  return {
    init,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    setAutoUpdateEnabled,
    getStatus
  }
}

module.exports = {
  createUpdateService
}
