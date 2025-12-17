const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Screen capture
  captureScreen: (displayId) => ipcRenderer.invoke('capture-screen', displayId),

  // LLM messaging
  sendMessage: (text, imageBase64, conversationHistory, summary) => ipcRenderer.invoke('send-message', { text, imageBase64, conversationHistory, summary }),
  generateSummary: (messages) => ipcRenderer.invoke('generate-summary', messages),

  // Listen for streaming message chunks
  onMessageChunk: (callback) => {
    ipcRenderer.on('message-chunk', (event, chunk) => callback(chunk))
  },

  // Listen for message complete
  onMessageComplete: (callback) => {
    ipcRenderer.on('message-complete', () => callback())
  },

  // Listen for message errors
  onMessageError: (callback) => {
    ipcRenderer.on('message-error', (_event, error) => callback(error))
  },

  // Listen for new chat event (from Ctrl+R)
  onNewChat: (callback) => {
    ipcRenderer.on('new-chat', () => callback())
  },

  // Listen for config changes (from settings window)
  onConfigChanged: (callback) => {
    ipcRenderer.on('config-changed', () => callback())
  },

  // Listen for reload settings request (when settings window is refocused)
  onReloadSettings: (callback) => {
    ipcRenderer.on('reload-settings', () => callback())
  },

  // Listen for collapse toggle (from Ctrl+')
  onToggleCollapse: (callback) => {
    ipcRenderer.on('toggle-collapse', () => callback())
  },

  // Config management
  saveApiKey: (provider, apiKey) => ipcRenderer.invoke('save-api-key', { provider, apiKey }),
  getApiKey: (provider) => ipcRenderer.invoke('get-api-key', provider),
  setActiveProvider: (provider) => ipcRenderer.invoke('set-active-provider', provider),
  getActiveProvider: () => ipcRenderer.invoke('get-active-provider'),
  getProviderConfig: (provider) => ipcRenderer.invoke('get-provider-config', provider),
  setProviderConfig: (provider, config) => ipcRenderer.invoke('set-provider-config', { provider, config }),
  validateApiKey: (provider) => ipcRenderer.invoke('validate-api-key', provider),

  // Mode management
  getModes: () => ipcRenderer.invoke('get-modes'),
  saveMode: (mode) => ipcRenderer.invoke('save-mode', mode),
  deleteMode: (modeId) => ipcRenderer.invoke('delete-mode', modeId),
  getActiveMode: () => ipcRenderer.invoke('get-active-mode'),
  setActiveMode: (modeId) => ipcRenderer.invoke('set-active-mode', modeId),

  // Memory settings
  getMemorySettings: () => ipcRenderer.invoke('get-memory-settings'),
  getHistoryLimit: () => ipcRenderer.invoke('get-history-limit'),
  setHistoryLimit: (limit) => ipcRenderer.invoke('set-history-limit', limit),
  setSummarizationEnabled: (enabled) => ipcRenderer.invoke('set-summarization-enabled', enabled),

  // Display detection
  getDisplays: () => ipcRenderer.invoke('get-displays'),

  // Window management
  openSettings: () => ipcRenderer.invoke('open-settings'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  setCollapsed: (collapsed, height) => ipcRenderer.send('set-collapsed', { collapsed, height }),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Icon management
  loadCustomIcons: () => ipcRenderer.invoke('load-custom-icons'),
  
  // Provider registry methods
  getAllProvidersMeta: () => ipcRenderer.invoke('get-all-providers-meta'),
  getConfiguredProviders: () => ipcRenderer.invoke('get-configured-providers'),

  // Session storage
  saveSession: (session) => ipcRenderer.invoke('save-session', session),
  loadSession: (id) => ipcRenderer.invoke('load-session', id),
  getAllSessions: () => ipcRenderer.invoke('get-all-sessions'),
  deleteSession: (id) => ipcRenderer.invoke('delete-session', id),
  searchSessions: (query) => ipcRenderer.invoke('search-sessions', query),

  // Cleanup listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
})
