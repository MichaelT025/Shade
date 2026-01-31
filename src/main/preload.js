const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Screen capture
  captureScreen: (displayId) => ipcRenderer.invoke('capture-screen', displayId),

  // LLM messaging
  sendMessage: (text, imageBase64, conversationHistory, summary) => ipcRenderer.invoke('send-message', { text, imageBase64, conversationHistory, summary }),
  stopMessage: () => ipcRenderer.invoke('stop-message'),
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

  // Listen for resume session requests
  onResumeSession: (callback) => {
    ipcRenderer.on('resume-session', (_event, sessionId) => callback(sessionId))
  },

  // Listen for session deletion (from dashboard)
  onSessionDeleted: (callback) => {
    ipcRenderer.on('session-deleted', (_event, sessionId) => callback(sessionId))
  },

  // Listen for config changes (from settings window)
  onConfigChanged: (callback) => {
    ipcRenderer.on('config-changed', () => callback())
  },

  // Listen for active mode changes (from dashboard)
  onActiveModeChanged: (callback) => {
    ipcRenderer.on('active-mode-changed', (_event, modeId) => callback(modeId))
  },

  // Listen for collapse toggle (from Ctrl+')
  onToggleCollapse: (callback) => {
    ipcRenderer.on('toggle-collapse', () => callback())
  },

  // Listen for screenshot capture request (from Ctrl+Shift+S)
  onCaptureScreenshot: (callback) => {
    ipcRenderer.on('capture-screenshot', () => callback())
  },

  // Listen for window shown event (for predictive screenshot capture)
  onWindowShown: (callback) => {
    ipcRenderer.on('window-shown', () => callback())
  },

  // Context menu commands
  onContextMenuCommand: (callback) => {
    ipcRenderer.on('context-menu-command', (_event, data) => callback(data))
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
  resetModes: () => ipcRenderer.invoke('reset-modes'),
  getDefaultModes: () => ipcRenderer.invoke('get-default-modes'),
  getActiveMode: () => ipcRenderer.invoke('get-active-mode'),
  setActiveMode: (modeId) => ipcRenderer.invoke('set-active-mode', modeId),

  // Memory settings
  getHistoryLimit: () => ipcRenderer.invoke('get-history-limit'),
  setHistoryLimit: (limit) => ipcRenderer.invoke('set-history-limit', limit),
  getExcludeScreenshotsFromMemory: () => ipcRenderer.invoke('get-exclude-screenshots-from-memory'),
  setExcludeScreenshotsFromMemory: (exclude) => ipcRenderer.invoke('set-exclude-screenshots-from-memory', exclude),

  // Screenshot behavior
  getScreenshotMode: () => ipcRenderer.invoke('get-screenshot-mode'),
  setScreenshotMode: (mode) => ipcRenderer.invoke('set-screenshot-mode', mode),

  // Session settings
  getSessionSettings: () => ipcRenderer.invoke('get-session-settings'),
  setAutoTitleSessions: (enabled) => ipcRenderer.invoke('set-auto-title-sessions', enabled),
  getStartCollapsed: () => ipcRenderer.invoke('get-start-collapsed'),
  setStartCollapsed: (startCollapsed) => ipcRenderer.invoke('set-start-collapsed', startCollapsed),
  generateSessionTitle: (assistantReply) => ipcRenderer.invoke('generate-session-title', assistantReply),

  // Display detection
  getDisplays: () => ipcRenderer.invoke('get-displays'),

  // Window management
  openSettings: () => ipcRenderer.invoke('open-settings'),
  closeModelSwitcher: () => ipcRenderer.invoke('close-model-switcher'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  deleteAllData: () => ipcRenderer.invoke('delete-all-data'),
  setCollapsed: (collapsed, height) => ipcRenderer.send('set-collapsed', { collapsed, height }),
  resumeSessionInOverlay: (sessionId) => ipcRenderer.invoke('resume-session-in-overlay', sessionId),
  startNewChatInOverlay: () => ipcRenderer.invoke('start-new-chat-in-overlay'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  minimizeDashboard: () => ipcRenderer.invoke('dashboard-minimize'),
  closeDashboard: () => ipcRenderer.invoke('dashboard-close'),
  showSessionContextMenu: (sessionId) => ipcRenderer.invoke('show-session-context-menu', sessionId),

  // Icon management
  loadCustomIcons: () => ipcRenderer.invoke('load-custom-icons'),
  
  // Provider registry methods
  getAllProvidersMeta: () => ipcRenderer.invoke('get-all-providers-meta'),

  // Model refresh methods
  refreshModels: (providerId) => ipcRenderer.invoke('refresh-models', providerId),
  checkModelCacheStale: (providerId) => ipcRenderer.invoke('check-model-cache-stale', providerId),

  // Session storage
  saveSession: (session) => ipcRenderer.invoke('save-session', session),
  loadSession: (id) => ipcRenderer.invoke('load-session', id),
  getAllSessions: () => ipcRenderer.invoke('get-all-sessions'),
  deleteSession: (id) => ipcRenderer.invoke('delete-session', id),
  renameSession: (id, newTitle) => ipcRenderer.invoke('rename-session', { id, newTitle }),
  toggleSessionSaved: (id) => ipcRenderer.invoke('toggle-session-saved', id),
  setSessionSaved: (id, isSaved) => ipcRenderer.invoke('set-session-saved', { id, isSaved }),
  searchSessions: (query) => ipcRenderer.invoke('search-sessions', query),
  getScreenshot: (sessionId, screenshotPath) => ipcRenderer.invoke('get-screenshot', { sessionId, screenshotPath }),

  // App metadata
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
 
  // Update checking
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
})
