/**
 * Provider Registry
 * Loads and manages LLM provider metadata from JSON configuration
 */

const fs = require('fs')
const path = require('path')

// Default providers JSON (embedded fallback)
const defaultProviders = {
  gemini: {
    name: 'Google Gemini',
    type: 'gemini',
    description: 'All Gemini models support vision',
    website: 'https://makersuite.google.com/app/apikey',
    defaultModel: 'gemini-2.0-flash-exp',
    lastFetched: null,
    models: {
      'gemini-2.0-flash-exp': { name: 'Gemini 2.0 Flash (Experimental)' },
      'gemini-1.5-flash': { name: 'Gemini 1.5 Flash' },
      'gemini-1.5-pro': { name: 'Gemini 1.5 Pro' }
    }
  },
  openai: {
    name: 'OpenAI',
    type: 'openai',
    description: 'Vision-capable GPT models',
    website: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o',
    lastFetched: null,
    models: {
      'gpt-4o': { name: 'GPT-4o' },
      'gpt-4o-mini': { name: 'GPT-4o Mini' },
      'o1': {
        name: 'o1',
        options: {
          reasoningEffort: 'high'
        }
      },
      'o1-mini': { name: 'o1 Mini' },
      'gpt-4-turbo': { name: 'GPT-4 Turbo' }
    }
  },
  anthropic: {
    name: 'Anthropic Claude',
    type: 'anthropic',
    description: 'All Claude models support vision',
    website: 'https://console.anthropic.com/',
    defaultModel: 'claude-sonnet-4',
    lastFetched: null,
    models: {
      'claude-sonnet-4': { name: 'Claude Sonnet 4' },
      'claude-opus-4': { name: 'Claude Opus 4' },
      'claude-3-5-sonnet-20241022': { name: 'Claude 3.5 Sonnet' },
      'claude-3-7-sonnet-20250219': { name: 'Claude 3.7 Sonnet' }
    }
  },
  grok: {
    name: 'Grok (X.AI)',
    type: 'openai-compatible',
    description: 'X.AI\'s vision-capable models',
    website: 'https://console.x.ai',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-vision-beta',
    lastFetched: null,
    models: {
      'grok-vision-beta': { name: 'Grok Vision Beta' },
      'grok-2-vision-1212': { name: 'Grok 2 Vision' }
    }
  },
  openrouter: {
    name: 'OpenRouter',
    type: 'openai-compatible',
    description: 'Access multiple AI models through one API',
    website: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    lastFetched: null,
    models: {
      'anthropic/claude-3.5-sonnet': { name: 'Claude 3.5 Sonnet' },
      'openai/gpt-4o': { name: 'GPT-4o' },
      'google/gemini-pro-1.5': { name: 'Gemini Pro 1.5' },
      'meta-llama/llama-3.2-11b-vision-instruct:free': { name: 'Llama 3.2 11B Vision (Free)' }
    }
  },
  ollama: {
    name: 'Ollama',
    type: 'openai-compatible',
    description: 'Run local models on your machine',
    website: 'https://ollama.ai/',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2-vision',
    lastFetched: null,
    models: {
      'llama3.2-vision': { name: 'Llama 3.2 Vision' },
      'llava': { name: 'LLaVA' },
      'bakllava': { name: 'BakLLaVA' }
    }
  },
  'lm-studio': {
    name: 'LM Studio',
    type: 'openai-compatible',
    description: 'Run local models with LM Studio',
    website: 'https://lmstudio.ai/',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: '',
    lastFetched: null,
    models: {}
  }
}

let providers = null
let providersPath = null

/**
 * Initialize providers path
 * @param {string} userDataPath - Path to user data directory
 */
function initProvidersPath(userDataPath) {
  if (!userDataPath) {
    // Fallback to default providers if no user data path
    providers = { ...defaultProviders }
    return
  }

  providersPath = path.join(userDataPath, 'shade-providers.json')
  loadProviders()
}

/**
 * Load providers from JSON file
 * Falls back to default providers if file doesn't exist
 */
function loadProviders() {
  try {
    if (providersPath && fs.existsSync(providersPath)) {
      const data = fs.readFileSync(providersPath, 'utf8')
      providers = JSON.parse(data)
      console.log('Loaded providers from:', providersPath)

      // Migrate: Add any missing providers from defaults
      let needsSave = false
      for (const [providerId, providerData] of Object.entries(defaultProviders)) {
        if (!providers[providerId]) {
          console.log(`Migrating: Adding missing provider '${providerId}'`)
          providers[providerId] = { ...providerData }
          needsSave = true
        }
      }

      // Save if we added any missing providers
      if (needsSave) {
        saveProviders()
        console.log('Provider migration completed')
      }
    } else {
      // Create default providers file
      providers = { ...defaultProviders }
      if (providersPath) {
        saveProviders()
        console.log('Created default providers file at:', providersPath)
      }
    }
  } catch (error) {
    console.error('Failed to load providers, using defaults:', error)
    providers = { ...defaultProviders }
  }
}

/**
 * Save providers to JSON file
 */
function saveProviders() {
  if (!providersPath) return

  try {
    fs.writeFileSync(providersPath, JSON.stringify(providers, null, 2), 'utf8')
  } catch (error) {
    console.error('Failed to save providers:', error)
  }
}

/**
 * Get all provider IDs
 * @returns {string[]} Array of provider IDs
 */
function getProviderIds() {
  if (!providers) {
    providers = { ...defaultProviders }
  }
  return Object.keys(providers)
}

/**
 * Get all provider metadata
 * @returns {Object} All provider metadata
 */
function getAllProviders() {
  if (!providers) {
    providers = { ...defaultProviders }
  }
  return { ...providers }
}

/**
 * Get provider metadata by ID
 * @param {string} id - Provider ID
 * @returns {Object|null} Provider metadata or null if not found
 */
function getProvider(id) {
  if (!providers) {
    providers = { ...defaultProviders }
  }
  return providers[id] || null
}

/**
 * Check if provider exists
 * @param {string} id - Provider ID
 * @returns {boolean} True if provider exists
 */
function hasProvider(id) {
  if (!providers) {
    providers = { ...defaultProviders }
  }
  if (!id) return false
  return Object.keys(providers).some(providerId =>
    providerId.toLowerCase() === id.toLowerCase()
  )
}

/**
 * Get models for a provider
 * @param {string} id - Provider ID
 * @returns {Array} Array of model objects with id and metadata
 */
function getModels(id) {
  const provider = getProvider(id)
  if (!provider || !provider.models) return []

  // Convert models object to array format
  return Object.entries(provider.models).map(([modelId, modelMeta]) => ({
    id: modelId,
    ...modelMeta
  }))
}

/**
 * Generate default providers config object for config-service
 * @returns {Object} Default providers config
 */
function generateDefaultProvidersConfig() {
  if (!providers) {
    providers = { ...defaultProviders }
  }

  const config = {}
  for (const [providerId, providerMeta] of Object.entries(providers)) {
    config[providerId] = {
      apiKey: '',
      model: providerMeta.defaultModel || ''
    }

    // Add baseUrl for openai-compatible providers
    if (providerMeta.baseUrl) {
      config[providerId].baseUrl = providerMeta.baseUrl
    }
  }

  return config
}

/**
 * Update provider models and save to file
 * @param {string} providerId - Provider ID
 * @param {Object} models - New models object
 */
function updateProviderModels(providerId, models) {
  if (!providers) {
    providers = { ...defaultProviders }
  }

  if (!providers[providerId]) {
    console.error(`Provider not found: ${providerId}`)
    return
  }

  // Update models and lastFetched timestamp
  providers[providerId].models = models
  providers[providerId].lastFetched = new Date().toISOString()

  // Save to file
  saveProviders()
  console.log(`Updated models for ${providerId}:`, Object.keys(models).length, 'models')
}

module.exports = {
  initProvidersPath,
  loadProviders,
  getProviderIds,
  getAllProviders,
  getProvider,
  hasProvider,
  getModels,
  generateDefaultProvidersConfig,
  updateProviderModels
}
