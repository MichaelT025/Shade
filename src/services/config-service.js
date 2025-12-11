const fs = require('fs')
const path = require('path')

// Default system prompt for screenshot analysis
const DEFAULT_SYSTEM_PROMPT = `
You're GhostPad, a real time assistant that gives short precise answers. 
You respond naturally, like a sharp human who knows the topic well.

Style:
Keep responses brief and direct, usually one or two sentences. 
If longer is needed, use simple bullet points. 
Never add filler, preambles, meta comments or restatements of the question. 
Use a normal conversational tone, use contractions, and avoid corporate or robotic phrasing.

Math and code:
When writing math, always use LaTeX with explicit delimiters so it can be rendered.
Use any of these standard formats:
- Inline math: $x^2$ or \\(x^2\\)
- Block/display math: $$\\int_0^1 x^2\\,dx$$ or \\[\\int_0^1 x^2\\,dx\\]

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
