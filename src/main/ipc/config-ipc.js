const { ipcMain, screen } = require('electron')
const LLMFactory = require('../../services/llm-factory')

function registerConfigIpcHandlers({ configService, updateService, sendToWindows, broadcastConfigChanged }) {
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

  ipcMain.handle('has-api-key', async (_event, provider) => {
    try {
      const apiKey = configService.getApiKey(provider)
      const hasApiKey = !!(apiKey && apiKey.trim().length > 0)
      return { success: true, hasApiKey }
    } catch (error) {
      console.error('Failed to check API key state:', error)
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
      const meta = LLMFactory.getProviderMeta(provider)
      const isLocalProvider = !!(meta && (meta.requiresApiKey === false || (meta.type === 'openai-compatible' && typeof meta.baseUrl === 'string' && meta.baseUrl.includes('localhost'))))

      if (isLocalProvider) {
        return { success: true, isValid: true }
      }

      if (!apiKey) {
        return { success: false, isValid: false, error: 'No API key configured' }
      }

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
      const displays = screen.getAllDisplays().map((display, index) => ({
        id: display.id,
        index,
        primary: display.bounds.x === 0 && display.bounds.y === 0,
        width: display.size.width,
        height: display.size.height,
        scaleFactor: display.scaleFactor
      }))
      return { success: true, displays }
    } catch (error) {
      console.error('Failed to get displays:', error)
      return { success: false, displays: [], error: error.message }
    }
  })

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
      sendToWindows('config-changed')
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
      return { success: true }
    } catch (error) {
      console.error('Failed to set history limit:', error)
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
      sendToWindows('config-changed')
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
      sendToWindows('config-changed')
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
      sendToWindows('config-changed')
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
      sendToWindows('config-changed')
      return { success: true }
    } catch (error) {
      console.error('Failed to set start collapsed setting:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-auto-update-enabled', async () => {
    try {
      const enabled = configService.getAutoUpdateEnabled()
      return { success: true, enabled }
    } catch (error) {
      console.error('Failed to get auto update setting:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('set-auto-update-enabled', async (_event, enabled) => {
    try {
      if (updateService) {
        updateService.setAutoUpdateEnabled(enabled)
      } else {
        configService.setAutoUpdateEnabled(enabled)
      }
      sendToWindows('config-changed')
      return { success: true }
    } catch (error) {
      console.error('Failed to set auto update setting:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-exclude-overlay-from-screenshots', async () => {
    try {
      const exclude = configService.getExcludeOverlayFromScreenshots()
      return { success: true, exclude }
    } catch (error) {
      console.error('Failed to get overlay screenshot exclusion setting:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('set-exclude-overlay-from-screenshots', async (_event, exclude) => {
    try {
      configService.setExcludeOverlayFromScreenshots(exclude)
      sendToWindows('config-changed')
      return { success: true }
    } catch (error) {
      console.error('Failed to set overlay screenshot exclusion setting:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('refresh-models', async (_event, providerId) => {
    try {
      const ModelRefreshService = require('../../services/model-refresh')
      const apiKey = configService.getApiKey(providerId)
      const result = await ModelRefreshService.refreshModels(providerId, apiKey)

      if (result.success) {
        return { success: true, models: result.models }
      }
      return { success: false, error: result.error }
    } catch (error) {
      console.error('Error in refresh-models handler:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('check-model-cache-stale', async (_event, providerId) => {
    try {
      const ModelRefreshService = require('../../services/model-refresh')
      const isStale = ModelRefreshService.isCacheStale(providerId)
      return { success: true, isStale }
    } catch (error) {
      console.error('Error checking cache staleness:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('get-all-providers-meta', async () => {
    try {
      const providers = LLMFactory.getAllProvidersMeta()
      return { success: true, providers }
    } catch (error) {
      console.error('Failed to get provider metadata:', error)
      return { success: false, error: error.message }
    }
  })
}

module.exports = {
  registerConfigIpcHandlers
}
