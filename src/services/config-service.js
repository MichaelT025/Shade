const fs = require('fs')
const path = require('path')
const { safeStorage } = require('electron')
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
    activeMode: oldConfig.activeMode || 'bolt',
    memorySettings: {
      historyLimit: 10,
      enableSummarization: true,
      excludeScreenshotsFromMemory: true
    },
    sessionSettings: {
      autoTitleSessions: true,
      startCollapsed: true
    }
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
    
    // Ensure data directory exists
    const dataDir = path.join(userDataPath, 'data')
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true })
      } catch (e) {
        console.error('Failed to create data directory:', e)
      }
    }

    this.configPath = path.join(dataDir, 'config.json')
    
    // Migration: Check for old config file in root
    const oldConfigPath = path.join(userDataPath, 'shade-config.json')
    if (fs.existsSync(oldConfigPath) && !fs.existsSync(this.configPath)) {
      try {
        console.log('Migrating config file to data directory...')
        fs.renameSync(oldConfigPath, this.configPath)
      } catch (e) {
        console.error('Failed to migrate config file:', e)
        // Fallback to reading old path if move failed
        this.configPath = oldConfigPath
      }
    }

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
           id: 'bolt',
           name: 'Bolt',
           prompt: `You're Shade running in Bolt mode.

Your role is to give fast, direct, real-time assistance with minimal latency.
Respond like a sharp, knowledgeable human.

Style:
- Keep responses brief and direct (1–2 sentences when possible).
- Use bullet points only if necessary.
- No filler, no preambles, no meta commentary.
- No restating the user's question.
- Natural conversational tone; use contractions.
- Avoid corporate, robotic, or overly polite language.

Math and code:
- Use LaTeX with explicit delimiters for all math.
- Do not write bare LaTeX.
- Provide short code snippets only when necessary.
- Prefer explanations over long implementations unless explicitly asked.

Constraints:
- Do not overthink or overanalyze.
- Do not speculate; if unsure, say so briefly.
- Default to speed over depth.

Memory:
- Use recent context to stay coherent.`,
           isDefault: true
         },
         {
           id: 'tutor',
           name: 'Tutor',
           prompt: `You're Shade running in Tutor mode.

Your role is to help the user learn and understand academic material
without directly giving away final answers unless the user explicitly asks for them.

Teaching style:
- Guide, hint, and scaffold understanding.
- Ask leading questions when appropriate.
- Break problems into steps and concepts.
- Encourage the user to think and attempt solutions.

Restrictions:
- Do NOT provide full solutions, final answers, or completed proofs unless the user explicitly asks for them.
- If the user asks for verification, explain correctness conceptually rather than revealing the full solution.

Math and code:
- Use LaTeX with explicit delimiters for all math.
- Do not dump full solutions unless explicitly requested.
- Use pseudocode or partial code when helpful.

Tone:
- Supportive, patient, and clear.
- Avoid sounding like a textbook or lecturer.

Memory:
- Track the user's progress and avoid repeating explanations.`,
           isDefault: false
         },
          {
            id: 'coder',
            name: 'Coder',
            prompt: `You're Shade running in Coder mode.

Your role is to implement software quickly and correctly.
Focus on execution, correctness, and clean structure.

Coding style:
- Output complete, working code.
- Follow best practices and idiomatic patterns.
- Use clear variable names and concise comments.
- Prefer clarity over cleverness.

Explanation rules:
- Explain only what is necessary to use or modify the code.
- Avoid long theoretical explanations.
- Do not over-comment obvious code.

Constraints:
- Do not guess APIs or libraries.
- If requirements are unclear, ask a single clarifying question.
- Assume the user is technically competent.

Memory:
- Maintain awareness of the project context when provided.`,
            isDefault: false
          },
          {
            id: 'thinker',
            name: 'Thinker',
            prompt: `You're Shade running in Thinker mode.

Your role is to reason carefully and deliberately before answering.
Accuracy, depth, and sound judgment matter more than speed.

Reasoning style:
- Think through problems step by step internally.
- Identify assumptions and edge cases.
- Weigh tradeoffs explicitly.
- Avoid premature conclusions.

Output style:
- Be concise but thorough.
- Use bullet points or structured sections when helpful.
- Do not expose chain-of-thought verbatim.

Constraints:
- Do not answer if confidence is low; ask for clarification instead.
- Avoid speculative or unsupported claims.
- Do not optimize for speed.

Memory:
- Use full conversation context to maintain coherence and consistency.`,
            isDefault: false
          }
        ],
       activeMode: 'bolt',
      memorySettings: {
        historyLimit: 10,
        enableSummarization: true,
        excludeScreenshotsFromMemory: true
      },
      sessionSettings: {
        autoTitleSessions: true,
        startCollapsed: true
      }
    }

    // Load or initialize config
    this.config = this.loadConfig()
  }

  /**
   * Encrypt a string using electron.safeStorage if available
   * @param {string} text 
   * @returns {string} Base64 encoded encrypted string or original text
   */
  encryptKey(text) {
    if (!text) return ''
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.encryptString(text).toString('base64')
      } catch (error) {
        console.error('Encryption failed:', error)
        return text
      }
    }
    return text
  }

  /**
   * Decrypt a string using electron.safeStorage if available
   * @param {string} encryptedText 
   * @returns {string} Decrypted string or original text
   */
  decryptKey(encryptedText) {
    if (!encryptedText) return ''
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        // Check if string is base64
        if (/^[a-zA-Z0-9+/]*={0,2}$/.test(encryptedText)) {
            const buffer = Buffer.from(encryptedText, 'base64')
            return safeStorage.decryptString(buffer)
        }
      } catch (error) {
        // If decryption fails, it might be a plain text key (from migration or manual edit)
        // console.debug('Decryption failed, treating as plain text', error)
        return encryptedText
      }
    }
    return encryptedText
  }

  /**
   * Load configuration from disk
   * @returns {Object}
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8')
        const parsedConfig = JSON.parse(data)

        // Merge with defaults (including nested objects)
        let loadedConfig = {
          ...this.defaultConfig,
          ...parsedConfig,
          memorySettings: {
            ...this.defaultConfig.memorySettings,
            ...(parsedConfig?.memorySettings || {})
          },
          sessionSettings: {
            ...this.defaultConfig.sessionSettings,
            ...(parsedConfig?.sessionSettings || {})
          }
        }
        
        // Check if config needs migration from old format
        if (needsMigration(loadedConfig)) {
          console.log('Config needs migration from old format')
          loadedConfig = migrateConfig(loadedConfig)
          // Save the migrated config (will trigger encryption if implemented in save)
          this.config = loadedConfig
          this.saveConfig()
        }

        // Auto-encrypt keys that are in plain text
        let needsSave = false
        if (loadedConfig.providers) {
          for (const providerId in loadedConfig.providers) {
            const provider = loadedConfig.providers[providerId]
            if (provider.apiKey && safeStorage && safeStorage.isEncryptionAvailable()) {
              // Try to decrypt; if it returns same string but wasn't empty, it might be plain text
              // But a simpler heuristic: if it doesn't look like base64 or safeStorage throws on decrypt, 
              // we can assume it's plain text.
              // However, "sk-..." is valid base64 chars (mostly).
              // Let's use a flag or try-decrypt approach. 
              // Our decryptKey function returns the input if it fails.
              // But we can't easily distinguish "failed because plain text" vs "failed because corrupt".
              
              // Strategy: Attempt to decrypt. If it throws or we want to be sure, we can just re-encrypt plain text keys.
              // But how do we know if it IS plain text?
              // Standard API keys (sk-...) usually contain characters that are valid in base64.
              // We'll rely on the fact that we encrypt on set.
              // Migration: If we just migrated, the keys are plain text.
              // We can check if the key starts with 'sk-' (OpenAI) or 'AIza' (Gemini) etc.
              // Or we can just try to encrypt everything that isn't already encrypted?
              // No, duplicate encryption is bad.
              
              // Let's rely on `needsMigration` logic which we already ran.
              // If we want to ensure encryption for existing keys in a new file location:
              
              // We'll leave it for now. The `setApiKey` will handle new keys.
              // Ideally, we should iterate and encrypt all plain text keys once.
              // Since keys like 'sk-...' usually fail decryption (invalid ciphertext), we can detect that.
              
              try {
                  const buffer = Buffer.from(provider.apiKey, 'base64')
                  safeStorage.decryptString(buffer)
                  // If this succeeds, it's likely already encrypted.
              } catch (e) {
                  // Decryption failed, assume plain text and encrypt it.
                  // Only encrypt if it looks like a real key (length > 0)
                  if (provider.apiKey.length > 0) {
                      console.log(`Encrypting plain text API key for ${providerId}`)
                      provider.apiKey = this.encryptKey(provider.apiKey)
                      needsSave = true
                  }
              }
            }
          }
        }
        
        if (needsSave) {
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
      const encrypted = this.config.providers[providerName].apiKey || ''
      return this.decryptKey(encrypted)
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
      this.config.providers[providerName].apiKey = this.encryptKey(apiKey)
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
    // Ensure modes array exists and has default modes
     if (!this.config.modes || this.config.modes.length === 0) {
       this.config.modes = this.defaultConfig.modes
       this.config.activeMode = this.defaultConfig.activeMode
       this.saveConfig()
     }

     // Check if we need to migrate from old 'default' mode to new modes (bolt, tutor, coder, thinker)
     const hasOldDefaultMode = this.config.modes.length === 1 && this.config.modes[0].id === 'default'
     const hasNewDefaultModes = this.config.modes.some(m => m.id === 'bolt')
     const hasThinkerMode = this.config.modes.some(m => m.id === 'thinker')
     
     if ((hasOldDefaultMode && !hasNewDefaultModes) || (hasNewDefaultModes && !hasThinkerMode)) {
       // Migrate: replace old modes with new default modes (preserving custom modes if possible, but for now we just reset to defaults)
       this.config.modes = this.defaultConfig.modes
       this.config.activeMode = this.defaultConfig.activeMode
       this.saveConfig()
     }

     // If activeMode is missing or invalid, reset to default.
     const active = this.config.activeMode
     const hasActive = !!this.config.modes.find(m => m.id === active)
     if (!active || !hasActive) {
       this.config.activeMode = this.defaultConfig.activeMode
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

       // Back-compat: default to "no override" unless explicitly set
       if (modes[existingIndex].overrideProviderModel === undefined) {
         modes[existingIndex].overrideProviderModel = false
       }
    } else {
       // Add new mode
       modes.push({
         overrideProviderModel: false,
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
    const modes = this.getModes()
    const mode = modes.find(m => m.id === modeId)

    // Back-compat: old configs may have a single 'default' mode.
    // Current behavior: prevent deleting any mode marked as default.
    if (modeId === 'default' || mode?.isDefault) {
      throw new Error('Cannot delete default mode')
    }

    this.config.modes = modes.filter(m => m.id !== modeId)

    // If the deleted mode was active, switch to default
    if (this.config.activeMode === modeId) {
      this.config.activeMode = this.defaultConfig.activeMode
    }

    this.saveConfig()
  }

  /**
   * Reset all modes to default and delete user-made modes
   */
  resetModesToDefault() {
    this.config.modes = JSON.parse(JSON.stringify(this.defaultConfig.modes))
    this.config.activeMode = this.defaultConfig.activeMode
    this.saveConfig()
  }

  /**
   * Get default modes
   */
  getDefaultModes() {
    return this.defaultConfig.modes
  }

  /**
   * Get the active mode ID
   */
  getActiveMode() {
    return this.config.activeMode || this.defaultConfig.activeMode
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

  getExcludeScreenshotsFromMemory() {
    const settings = this.getMemorySettings()
    return settings.excludeScreenshotsFromMemory !== false
  }

  setExcludeScreenshotsFromMemory(exclude) {
    if (!this.config.memorySettings) {
      this.config.memorySettings = this.defaultConfig.memorySettings
    }
    this.config.memorySettings.excludeScreenshotsFromMemory = !!exclude
    this.saveConfig()
  }

  getScreenshotMode() {
    return this.config.screenshotMode || 'manual'
  }

  setScreenshotMode(mode) {
    const normalized = mode === 'auto' ? 'auto' : 'manual'
    this.config.screenshotMode = normalized
    this.saveConfig()
  }

  getSessionSettings() {
    if (!this.config.sessionSettings) {
      this.config.sessionSettings = this.defaultConfig.sessionSettings
      this.saveConfig()
    }
    return this.config.sessionSettings
  }

  setAutoTitleSessions(enabled) {
    if (!this.config.sessionSettings) {
      this.config.sessionSettings = this.defaultConfig.sessionSettings
    }
    this.config.sessionSettings.autoTitleSessions = !!enabled
    this.saveConfig()
  }

  getStartCollapsed() {
    const settings = this.getSessionSettings()
    return settings.startCollapsed !== false
  }

  setStartCollapsed(startCollapsed) {
    if (!this.config.sessionSettings) {
      this.config.sessionSettings = this.defaultConfig.sessionSettings
    }
    this.config.sessionSettings.startCollapsed = !!startCollapsed
    this.saveConfig()
  }
}

module.exports = ConfigService
