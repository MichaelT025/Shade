const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Screen capture
  captureScreen: (displayId) => ipcRenderer.invoke('capture-screen', displayId),

  // LLM messaging
  sendMessage: (text, imageBase64, conversationHistory) => ipcRenderer.invoke('send-message', { text, imageBase64, conversationHistory }),

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

  // Display detection
  getDisplays: () => ipcRenderer.invoke('get-displays'),

  // Window management
  openSettings: () => ipcRenderer.invoke('open-settings'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Icon management
  loadCustomIcons: () => ipcRenderer.invoke('load-custom-icons'),

  // Cleanup listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
})
