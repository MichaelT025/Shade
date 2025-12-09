const fs = require('fs')
const path = require('path')

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
      primaryDisplay: 0
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
}

module.exports = ConfigService
