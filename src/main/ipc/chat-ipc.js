const { ipcMain } = require('electron')
const { captureAndCompress } = require('../../services/screen-capture')
const LLMFactory = require('../../services/llm-factory')

function createChatIpcRegistrar({
  configService,
  getMainWindow
}) {
  let currentAbortController = null
  let predictiveScreenshotCache = null
  let predictiveScreenshotTimestamp = null
  let captureInProgress = false
  const PREDICTIVE_SCREENSHOT_MAX_AGE = 15000

  function hasFreshPredictiveScreenshot() {
    if (!predictiveScreenshotCache || !predictiveScreenshotTimestamp) {
      return false
    }

    return (Date.now() - predictiveScreenshotTimestamp) < PREDICTIVE_SCREENSHOT_MAX_AGE
  }

  function clearPredictiveScreenshotCache() {
    predictiveScreenshotCache = null
    predictiveScreenshotTimestamp = null
  }

  function isLocalProvider(providerName) {
    try {
      const meta = LLMFactory.getProviderMeta(providerName)
      if (!meta) return false
      if (meta.requiresApiKey === false) return true
      return meta.type === 'openai-compatible' && typeof meta.baseUrl === 'string' && meta.baseUrl.includes('localhost')
    } catch {
      return false
    }
  }

  function registerChatIpcHandlers() {
    ipcMain.handle('capture-screen', async (_event, payload) => {
      const mainWindow = getMainWindow()
      try {
        let captureMode = 'unknown'

        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          captureMode = typeof payload.captureMode === 'string' ? payload.captureMode : 'unknown'
        } else {
          captureMode = 'legacy'
        }

        // Reject overlapping predictive captures — screen capture is expensive
        if (captureMode === 'predictive' && captureInProgress) {
          return { success: false, error: 'Capture already in progress' }
        }

        captureInProgress = true
        console.log('Screen capture requested:', captureMode)

        // When the "exclude overlay from screenshots" config is ON, protection
        // is always active — skip the per-capture toggle + 60ms DWM delay.
        const alwaysProtected = configService
          ? configService.getExcludeOverlayFromScreenshots()
          : false
        const needsPerCaptureProtection = !alwaysProtected
        if (needsPerCaptureProtection && mainWindow) {
          mainWindow.setContentProtection(true)
        }

        // Only wait for DWM compositing when we just toggled protection on
        if (needsPerCaptureProtection) {
          await new Promise(resolve => setTimeout(resolve, 60))
        }

        const { base64, size } = await captureAndCompress({ captureMode })

        if (captureMode === 'predictive') {
          predictiveScreenshotCache = base64
          predictiveScreenshotTimestamp = Date.now()

          return {
            success: true,
            cachedAt: predictiveScreenshotTimestamp,
            size
          }
        }

        console.log(`Screenshot captured successfully (${(size / 1024 / 1024).toFixed(2)}MB)`)

        return { success: true, base64, size }
      } catch (error) {
        console.error('Failed to capture screen:', error)
        return { success: false, error: error.message }
      } finally {
        captureInProgress = false
        // Only toggle protection off if we toggled it on per-capture
        const alwaysProtectedFinal = configService
          ? configService.getExcludeOverlayFromScreenshots()
          : false
        if (!alwaysProtectedFinal && mainWindow) {
          mainWindow.setContentProtection(false)
        }
      }
    })

    ipcMain.handle('clear-predictive-screenshot', async () => {
      clearPredictiveScreenshotCache()
      return { success: true }
    })

    ipcMain.handle('consume-predictive-screenshot', async () => {
      if (!hasFreshPredictiveScreenshot()) {
        clearPredictiveScreenshotCache()
        return { success: false, error: 'Predictive screenshot is missing or stale' }
      }

      const base64 = predictiveScreenshotCache
      clearPredictiveScreenshotCache()
      return { success: true, base64 }
    })

    // Legacy handler kept for backward compatibility — now reads from config.
    ipcMain.handle('set-persistent-content-protection', async () => {
      const mainWindow = getMainWindow()
      const enabled = configService
        ? configService.getExcludeOverlayFromScreenshots()
        : false
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setContentProtection(!!enabled)
      }
      return { success: true }
    })

    ipcMain.handle('send-message', async (event, { text, imageBase64, conversationHistory, summary, usePredictiveScreenshot }) => {
      try {
        let resolvedImageBase64 = imageBase64
        if (!resolvedImageBase64 && usePredictiveScreenshot && hasFreshPredictiveScreenshot()) {
          resolvedImageBase64 = predictiveScreenshotCache
        }

        if (usePredictiveScreenshot) {
          clearPredictiveScreenshotCache()
        }

        console.log('Message send requested', {
          hasText: typeof text === 'string' && text.length > 0,
          textLength: typeof text === 'string' ? text.length : 0,
          hasImage: !!resolvedImageBase64,
          hasSummary: !!summary,
          historyLength: Array.isArray(conversationHistory) ? conversationHistory.length : 0
        })

        if (currentAbortController) {
          currentAbortController.abort()
        }
        currentAbortController = new AbortController()

        let providerName = configService.getActiveProvider()
        const activeModeId = configService.getActiveMode()
        const activeMode = configService.getMode(activeModeId)
        if (activeMode?.overrideProviderModel && activeMode?.provider) {
          providerName = activeMode.provider
        }

        const apiKey = configService.getApiKey(providerName)
        if (!isLocalProvider(providerName) && !apiKey) {
          return {
            success: false,
            error: `No API key configured for ${providerName}. Please add your API key in settings.`
          }
        }

        const config = configService.getProviderConfig(providerName)
        const activeSystemPrompt = configService.getActiveSystemPrompt()
        const configWithPrompt = {
          ...config,
          systemPrompt: activeSystemPrompt
        }

        if (activeMode?.overrideProviderModel && activeMode?.provider) {
          if (activeMode.provider === providerName && activeMode.model) {
            configWithPrompt.model = activeMode.model
          }
        }

        const provider = LLMFactory.createProvider(providerName, apiKey, configWithPrompt)

        let historyWithSummary = conversationHistory || []
        let promptWithSummary = text

        if (summary) {
          if (historyWithSummary.length > 0) {
            const firstMsg = historyWithSummary[0]
            historyWithSummary = [
              {
                ...firstMsg,
                text: `[Context from earlier conversation: ${summary}]\n\n${firstMsg.text}`
              },
              ...historyWithSummary.slice(1)
            ]
          } else {
            promptWithSummary = `[Context from earlier conversation: ${summary}]\n\n${text}`
          }
        }

        await provider.streamResponse(promptWithSummary, resolvedImageBase64, historyWithSummary, (chunk) => {
          event.sender.send('message-chunk', chunk)
        }, currentAbortController.signal)

        event.sender.send('message-complete')

        console.log('Response streaming completed')

        return { success: true, provider: providerName }
      } catch (error) {
        if (error.name === 'AbortError' || error.message?.includes('abort')) {
          console.log('Request aborted by user')
          return { success: true, aborted: true }
        }
        console.error('Failed to send message:', error)
        event.sender.send('message-error', error.message)
        return { success: false, error: error.message }
      } finally {
        currentAbortController = null
      }
    })

    ipcMain.handle('stop-message', async () => {
      if (currentAbortController) {
        currentAbortController.abort()
        currentAbortController = null
        console.log('User requested to stop message generation')
        return { success: true }
      }
      return { success: false }
    })

    ipcMain.handle('generate-summary', async (_event, messages) => {
      try {
        console.log('Summary generation requested for', messages.length, 'messages')
        const providerName = configService.getActiveProvider()
        const apiKey = configService.getApiKey(providerName)

        if (!isLocalProvider(providerName) && !apiKey) {
          return { success: false, error: `No API key configured for ${providerName}` }
        }

        const config = configService.getProviderConfig(providerName)
        const summaryConfig = {
          ...config,
          systemPrompt: ''
        }

        const provider = LLMFactory.createProvider(providerName, apiKey, summaryConfig)
        const conversationText = messages
          .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 500)}`)
          .join('\n\n')

        const summaryPrompt = `Summarize this conversation concisely (under 200 words). Focus on:\n- Main topics discussed\n- Key decisions or conclusions\n- Important context for future messages\n\nConversation:\n${conversationText}\n\nProvide a clear, contextual summary:`

        let summary = ''
        await provider.streamResponse(summaryPrompt, null, [], (chunk) => {
          summary += chunk
        })

        console.log('Summary generated:', summary.length, 'characters')
        return { success: true, summary: summary.trim() }
      } catch (error) {
        console.error('Failed to generate summary:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('generate-session-title', async (_event, assistantReply) => {
      try {
        const replyText = typeof assistantReply === 'string' ? assistantReply.trim() : ''
        if (!replyText) {
          return { success: false, error: 'Empty reply' }
        }

        let providerName = configService.getActiveProvider()
        const activeModeId = configService.getActiveMode()
        const activeMode = configService.getMode(activeModeId)
        if (activeMode?.overrideProviderModel && activeMode?.provider) {
          providerName = activeMode.provider
        }

        const apiKey = configService.getApiKey(providerName)
        if (!isLocalProvider(providerName) && !apiKey) {
          return { success: false, error: `No API key configured for ${providerName}` }
        }

        const config = configService.getProviderConfig(providerName)
        const titleConfig = {
          ...config,
          systemPrompt: ''
        }

        if (activeMode?.overrideProviderModel && activeMode?.provider === providerName && activeMode?.model) {
          titleConfig.model = activeMode.model
        }

        const provider = LLMFactory.createProvider(providerName, apiKey, titleConfig)
        const prompt = `Create a short session title (3-6 words) based on the assistant reply below.\nRules:\n- Return ONLY the title\n- No quotes\n- No punctuation at the end\n- Title case is optional\n- Keep under 42 characters\n\nAssistant reply:\n${replyText}`

        let raw = ''
        await provider.streamResponse(prompt, null, [], (chunk) => {
          raw += chunk
        })

        let title = (raw || '').trim()
        title = title.replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').trim()
        title = title.replace(/\s+/g, ' ')
        title = title.replace(/[\.!?]+$/g, '').trim()

        const maxLen = 42
        if (title.length > maxLen) {
          title = title.slice(0, maxLen).trimEnd()
        }

        if (!title) {
          return { success: false, error: 'Failed to generate title' }
        }

        return { success: true, title }
      } catch (error) {
        console.error('Failed to generate session title:', error)
        return { success: false, error: error.message }
      }
    })
  }

  return {
    registerChatIpcHandlers
  }
}

module.exports = {
  createChatIpcRegistrar
}
