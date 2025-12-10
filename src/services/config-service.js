const fs = require('fs')
const path = require('path')

// Default system prompt for screenshot analysis
const DEFAULT_SYSTEM_PROMPT = `You're a real-time assistant that gives the user info during meetings and other workflows. Your goal is to answer the user's query directly.

Responses must be EXTREMELY short and terse

- Aim for 1-2 sentences, and if longer, use bullet points for structure
- Get straight to the point and NEVER add filler, preamble, or meta-comments
- Never give the user a direct script or word track to say, your responses must be informative
- Don't end with a question or prompt to the user
- If an example story is needed, give one specific example story without making up details
- If a response calls for code, write all code required with detailed comments

Tone must be natural, human, and conversational

- Never be robotic or overly formal
- Use contractions naturally ("it's" not "it is")
- Occasionally start with "And" or "But" or use a sentence fragment for flow
- NEVER use hyphens or dashes, split into shorter sentences or use commas
- Avoid unnecessary adjectives or dramatic emphasis unless it adds clear value`

/**
 * Configuration management for GhostPad
 * Stores API keys and provider configurations using simple JSON file
 */
class ConfigService {
  constructor(userDataPath) {
    // Use provided user data path (must be passed from main process after app is ready)
    if (!userDataPath) {
      throw new Error('userDataPath is required for ConfigService')
    }
    this.configPath = path.join(userDataPath, 'ghostpad-config.json')

    // Default configuration
    this.defaultConfig = {
      llmProvider: 'gemini',
      geminiApiKey: '',
      openaiApiKey: '',
      anthropicApiKey: '',
      geminiConfig: {
        model: 'gemini-2.5-flash'
      },
      openaiConfig: {
        model: 'gpt-4-vision-preview'
      },
      anthropicConfig: {
        model: 'claude-3-sonnet-20240229'
      },
      primaryDisplay: 0,
      modes: [
        {
          id: 'default',
          name: 'Default',
          prompt: DEFAULT_SYSTEM_PROMPT,
          isDefault: true
        }
      ],
      activeMode: 'default'
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
        const loadedConfig = { ...this.defaultConfig, ...JSON.parse(data) }

        // Migrate old Gemini 1.5 models to 2.5 (1.5 models no longer supported in v1beta API)
        if (loadedConfig.geminiConfig && loadedConfig.geminiConfig.model) {
          const oldModel = loadedConfig.geminiConfig.model
          if (oldModel.includes('1.5')) {
            console.log(`Migrating old Gemini model ${oldModel} to gemini-2.5-flash`)
            loadedConfig.geminiConfig.model = 'gemini-2.5-flash'
            // Save the migrated config
            this.config = loadedConfig
            this.saveConfig()
          }
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
    return this.config.llmProvider
  }

  /**
   * Set the active LLM provider
   * @param {string} providerName
   */
  setActiveProvider(providerName) {
    this.config.llmProvider = providerName
    this.saveConfig()
  }

  /**
   * Get API key for a specific provider
   * @param {string} providerName
   * @returns {string}
   */
  getApiKey(providerName) {
    return this.config[`${providerName}ApiKey`] || ''
  }

  /**
   * Set API key for a specific provider
   * @param {string} providerName
   * @param {string} apiKey
   */
  setApiKey(providerName, apiKey) {
    this.config[`${providerName}ApiKey`] = apiKey
    this.saveConfig()
  }

  /**
   * Get configuration for a specific provider
   * @param {string} providerName
   * @returns {Object}
   */
  getProviderConfig(providerName) {
    return this.config[`${providerName}Config`] || {}
  }

  /**
   * Set configuration for a specific provider
   * @param {string} providerName
   * @param {Object} config
   */
  setProviderConfig(providerName, config) {
    this.config[`${providerName}Config`] = config
    this.saveConfig()
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
}

module.exports = ConfigService
