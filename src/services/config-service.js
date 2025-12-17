const fs = require('fs')
const path = require('path')
const ProviderRegistry = require('./provider-registry')

// Default system prompt for screenshot analysis
const DEFAULT_SYSTEM_PROMPT = `
You're Shade, a real time assistant that gives short precise answers. 
You respond naturally, like a sharp human who knows the topic well.

Style:
Keep responses brief and direct, usually one or two sentences. 
If longer is needed, use simple bullet points. 
Never add filler, preambles, meta comments or restatements of the question. 
Use a normal conversational tone, use contractions, and avoid corporate or robotic phrasing.

Math and code:
When writing math, always use LaTeX with explicit delimiters so it can be rendered.
Use any of these standard formats:
- Inline math: $x^2$ or \(x^2\)
- Block/display math: $$\int_0^1 x^2\,dx$$ or \[\int_0^1 x^2\,dx\]

Do NOT write bare LaTeX without delimiters.
Do NOT put math inside fenced code blocks unless explicitly asked for raw LaTeX.

When code is needed, output complete working code with clear comments.
Explain only what's required to solve the user's request.

Emails:
Write emails in a natural human voice that matches the user's style. 
Keep them concise and avoid stiff formal language. 
Don't use generic AI sounding phrasing.

Uncertainty:
If you're unsure about something, say so briefly and ask a clarifying question. 
Never guess or state uncertain information confidently.

Constraints:
Do not give the user scripts or exact word tracks for meetings. 
Do not end responses with questions unless asking for clarification due to uncertainty. 
Stay accurate and grounded at all times.

Memory:
Use the recent messages to maintain coherent context.

`

/**
 * Check if config is in old format (has geminiApiKey field)
 * @param {Object} config - Configuration object
 * @returns {boolean} True if config is in old format
 */
function needsMigration(config) {
  return config && (config.geminiApiKey !== undefined || config.geminiConfig !== undefined)
}

/**
 * Migrate config from old format to new format
 * @param {Object} oldConfig - Old configuration object
 * @returns {Object} New configuration object
 */
function migrateConfig(oldConfig) {
  // If already in new format, return as-is
  if (!needsMigration(oldConfig)) {
    return oldConfig
  }

  console.log('Migrating config from old format to new format')

  // Create new config structure
  const newConfig = {
    activeProvider: oldConfig.llmProvider || 'gemini',
    providers: ProviderRegistry.generateDefaultProvidersConfig(),
    screenshotMode: 'manual',
    memoryLimit: 30,
    modes: oldConfig.modes || [],
    activeMode: oldConfig.activeMode || 'default'
  }

  // Migrate provider data
  if (oldConfig.geminiApiKey) {
    newConfig.providers.gemini.apiKey = oldConfig.geminiApiKey
  }
  if (oldConfig.openaiApiKey) {
    newConfig.providers.openai.apiKey = oldConfig.openaiApiKey
  }
  if (oldConfig.anthropicApiKey) {
    newConfig.providers.anthropic.apiKey = oldConfig.anthropicApiKey
  }
  if (oldConfig.customApiKey) {
    newConfig.providers.custom.apiKey = oldConfig.customApiKey
  }

  // Migrate provider configs
  if (oldConfig.geminiConfig) {
    newConfig.providers.gemini.model = oldConfig.geminiConfig.model || 'gemini-2.5-flash'
  }
  if (oldConfig.openaiConfig) {
    newConfig.providers.openai.model = oldConfig.openaiConfig.model || 'gpt-4.1'
  }
  if (oldConfig.anthropicConfig) {
    newConfig.providers.anthropic.model = oldConfig.anthropicConfig.model || 'claude-sonnet-4-5'
  }
  if (oldConfig.customConfig) {
    newConfig.providers.custom.model = oldConfig.customConfig.model || ''
    newConfig.providers.custom.baseUrl = oldConfig.customConfig.baseUrl || ''
  }

  // Migrate other fields
  if (oldConfig.modes) {
    newConfig.modes = oldConfig.modes
  }
  if (oldConfig.activeMode) {
    newConfig.activeMode = oldConfig.activeMode
  }

  return newConfig
}

/**
 * Configuration management for Shade
 * Stores API keys and provider configurations using simple JSON file
 */
class ConfigService {
  constructor(userDataPath) {
    // Use provided user data path (must be passed from main process after app is ready)
    if (!userDataPath) {
      throw new Error('userDataPath is required for ConfigService')
    }
    this.configPath = path.join(userDataPath, 'shade-config.json')

    // Initialize provider registry with user data path
    ProviderRegistry.initProvidersPath(userDataPath)

    // Get first available provider ID dynamically
    const providerIds = ProviderRegistry.getProviderIds()
    const defaultProvider = providerIds.length > 0 ? providerIds[0] : 'gemini'

    // Default configuration with new structure
    this.defaultConfig = {
      activeProvider: defaultProvider,
      providers: ProviderRegistry.generateDefaultProvidersConfig(),
      screenshotMode: 'manual',
      memoryLimit: 30,
      modes: [
        {
          id: 'default',
          name: 'Default',
          prompt: DEFAULT_SYSTEM_PROMPT,
          isDefault: true
        }
      ],
      activeMode: 'default',
      memorySettings: {
        historyLimit: 10,
        enableSummarization: true
      }
    }

    // Load or initialize config
    this.config = this.loadConfig()
  }

  /**
   * Load configuration from disk
   * @returns {Object}
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8')
        let loadedConfig = { ...this.defaultConfig, ...JSON.parse(data) }
        
        // Check if config needs migration from old format
        if (needsMigration(loadedConfig)) {
          console.log('Config needs migration from old format')
          loadedConfig = migrateConfig(loadedConfig)
          // Save the migrated config
          this.config = loadedConfig
          this.saveConfig()
        }

        return loadedConfig
      }
    } catch (error) {
      console.error('Failed to load config:', error)
    }
    return { ...this.defaultConfig }
  }

  /**
   * Save configuration to disk
   */
  saveConfig() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8')
    } catch (error) {
      console.error('Failed to save config:', error)
    }
  }

  /**
   * Get the active LLM provider name
   * @returns {string}
   */
  getActiveProvider() {
    return this.config.activeProvider
  }

  /**
   * Set the active LLM provider
   * @param {string} providerName
   */
  setActiveProvider(providerName) {
    this.config.activeProvider = providerName
    this.saveConfig()
  }

  /**
   * Get API key for a specific provider
   * @param {string} providerName
   * @returns {string}
   */
  getApiKey(providerName) {
    if (this.config.providers && this.config.providers[providerName]) {
      return this.config.providers[providerName].apiKey || ''
    }
    return ''
  }

  /**
   * Set API key for a specific provider
   * @param {string} providerName
   * @param {string} apiKey
   */
  setApiKey(providerName, apiKey) {
    if (this.config.providers) {
      if (!this.config.providers[providerName]) {
        this.config.providers[providerName] = {}
      }
      this.config.providers[providerName].apiKey = apiKey
      this.saveConfig()
    }
  }

  /**
   * Get configuration for a specific provider
   * @param {string} providerName
   * @returns {Object}
   */
  getProviderConfig(providerName) {
    if (this.config.providers && this.config.providers[providerName]) {
      return this.config.providers[providerName]
    }
    return {}
  }

  /**
   * Set configuration for a specific provider
   * @param {string} providerName
   * @param {Object} config
   */
  setProviderConfig(providerName, config) {
    if (this.config.providers) {
      if (!this.config.providers[providerName]) {
        this.config.providers[providerName] = {}
      }
      // Merge config instead of replacing to preserve existing fields like apiKey
      this.config.providers[providerName] = {
        ...this.config.providers[providerName],
        ...config
      }
      this.saveConfig()
    }
  }

  /**
   * Check if a provider has an API key configured
   * @param {string} providerName
   * @returns {boolean}
   */
  hasApiKey(providerName) {
    const apiKey = this.getApiKey(providerName)
    return apiKey && apiKey.length > 0
  }

  /**
   * Get all configuration data (for debugging/export)
   * @returns {Object}
   */
  getAllConfig() {
    return { ...this.config }
  }

  /**
   * Clear all configuration (reset to defaults)
   */
  clearAll() {
    this.config = { ...this.defaultConfig }
    this.saveConfig()
  }

  /**
   * Get all system prompt modes
   * @returns {Array}
   */
  getModes() {
    // Ensure modes array exists and has default mode
    if (!this.config.modes || this.config.modes.length === 0) {
      this.config.modes = [
        {
          id: 'default',
          name: 'Default',
          prompt: DEFAULT_SYSTEM_PROMPT,
          isDefault: true
        }
      ]
      this.saveConfig()
    }
    return this.config.modes
  }

  /**
   * Get a specific mode by ID
   * @param {string} modeId
   * @returns {Object|null}
   */
  getMode(modeId) {
    const modes = this.getModes()
    return modes.find(mode => mode.id === modeId) || null
  }

  /**
   * Save or update a mode
   * @param {Object} mode - Mode object with id, name, and prompt
   */
  saveMode(mode) {
    const modes = this.getModes()
    const existingIndex = modes.findIndex(m => m.id === mode.id)

    if (existingIndex >= 0) {
      // Update existing mode (but preserve isDefault flag)
      modes[existingIndex] = {
        ...mode,
        isDefault: modes[existingIndex].isDefault || false
      }
    } else {
      // Add new mode
      modes.push({
        ...mode,
        isDefault: false
      })
    }

    this.config.modes = modes
    this.saveConfig()
  }

  /**
   * Delete a mode by ID (cannot delete default mode)
   * @param {string} modeId
   */
  deleteMode(modeId) {
    if (modeId === 'default') {
      throw new Error('Cannot delete default mode')
    }

    const modes = this.getModes()
    this.config.modes = modes.filter(mode => mode.id !== modeId)

    // If the deleted mode was active, switch to default
    if (this.config.activeMode === modeId) {
      this.config.activeMode = 'default'
    }

    this.saveConfig()
  }

  /**
   * Get the active mode ID
   * @returns {string}
   */
  getActiveMode() {
    return this.config.activeMode || 'default'
  }

  /**
   * Set the active mode
   * @param {string} modeId
   */
  setActiveMode(modeId) {
    // Verify mode exists
    const mode = this.getMode(modeId)
    if (!mode) {
      throw new Error(`Mode not found: ${modeId}`)
    }

    this.config.activeMode = modeId
    this.saveConfig()
  }

  /**
   * Get the system prompt for the active mode
   * @returns {string}
   */
  getActiveSystemPrompt() {
    const modeId = this.getActiveMode()
    const mode = this.getMode(modeId)
    return mode ? mode.prompt : DEFAULT_SYSTEM_PROMPT
  }

  /**
   * Get memory settings
   * @returns {Object}
   */
  getMemorySettings() {
    if (!this.config.memorySettings) {
      this.config.memorySettings = this.defaultConfig.memorySettings
      this.saveConfig()
    }
    return this.config.memorySettings
  }

  /**
   * Get history limit for message context
   * @returns {number}
   */
  getHistoryLimit() {
    const settings = this.getMemorySettings()
    return settings.historyLimit || 10
  }

  /**
   * Set history limit
   * @param {number} limit
   */
  setHistoryLimit(limit) {
    if (!this.config.memorySettings) {
      this.config.memorySettings = this.defaultConfig.memorySettings
    }
    this.config.memorySettings.historyLimit = limit
    this.saveConfig()
  }

  /**
   * Check if summarization is enabled
   * @returns {boolean}
   */
  isSummarizationEnabled() {
    const settings = this.getMemorySettings()
    return settings.enableSummarization !== false
  }

  /**
   * Set summarization enabled state
   * @param {boolean} enabled
   */
  setSummarizationEnabled(enabled) {
    if (!this.config.memorySettings) {
      this.config.memorySettings = this.defaultConfig.memorySettings
    }
    this.config.memorySettings.enableSummarization = enabled
    this.saveConfig()
  }

  /**
   * Get summarization threshold
   * @returns {number}
   */
  getSummarizationThreshold() {
    const settings = this.getMemorySettings()
    return settings.summarizationThreshold || 15
  }

  /**
   * Set summarization threshold
   * @param {number} threshold
   */
  setSummarizationThreshold(threshold) {
    if (!this.config.memorySettings) {
      this.config.memorySettings = this.defaultConfig.memorySettings
    }
    this.config.memorySettings.summarizationThreshold = threshold
    this.saveConfig()
  }
}

module.exports = ConfigService
