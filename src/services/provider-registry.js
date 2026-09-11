/**
 * Provider Registry
 * Loads and manages LLM provider metadata from JSON configuration
 */

const fs = require('fs')
const path = require('path')
const { safeParseJson } = require('./utils/json-safe')
const { writeFileAtomicSync } = require('./utils/atomic-write')
const { getModelCapabilities: resolveCapabilities, mergeModelMetadata } = require('./model-capabilities')
const { providers: gatewayProviders } = require('./providers/gateway-catalog')

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
    defaultModel: 'claude-sonnet-4-5',
    lastFetched: null,
    models: {
      // Claude 4.5 (Latest - 2025)
      'claude-haiku-4-5': { name: 'Claude Haiku 4.5' },
      'claude-haiku-4-5-20251001': { name: 'Claude Haiku 4.5 (Oct 2025)' },
      'claude-sonnet-4-5': { name: 'Claude Sonnet 4.5' },
      'claude-sonnet-4-5-20250929': { name: 'Claude Sonnet 4.5 (Sep 2025)' },
      'claude-opus-4-5': { name: 'Claude Opus 4.5' },
      'claude-opus-4-5-20251101': { name: 'Claude Opus 4.5 (Nov 2025)' },

      // Claude 4.x (2025)
      'claude-sonnet-4': { name: 'Claude Sonnet 4' },
      'claude-sonnet-4-20250514': { name: 'Claude Sonnet 4 (May 2025)' },
      'claude-opus-4': { name: 'Claude Opus 4' },
      'claude-opus-4-20250514': { name: 'Claude Opus 4 (May 2025)' },
      'claude-opus-4-1-20250805': { name: 'Claude Opus 4.1 (Aug 2025)' },

      // Claude 3.7 (2025)
      'claude-3-7-sonnet-20250219': { name: 'Claude 3.7 Sonnet' },

      // Claude 3.5 (2024)
      'claude-3-5-sonnet-20241022': { name: 'Claude 3.5 Sonnet (Oct 2024)' },
      'claude-3-5-haiku-20241022': { name: 'Claude 3.5 Haiku (Oct 2024)' },

      // Claude 3 (2024)
      'claude-3-opus-20240229': { name: 'Claude 3 Opus' },
      'claude-3-haiku-20240307': { name: 'Claude 3 Haiku' }
    }
  },
  grok: {
    name: 'Grok (X.AI)',
    type: 'openai-compatible',
    requiresApiKey: true,
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
    requiresApiKey: true,
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
    requiresApiKey: false,
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
  ...gatewayProviders,
  'lm-studio': {
    name: 'LM Studio',
    type: 'openai-compatible',
    requiresApiKey: false,
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
    providersPath = null
    // Fallback to default providers if no user data path
    providers = JSON.parse(JSON.stringify(defaultProviders))
    return
  }

  const dataDir = path.join(userDataPath, 'data')
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true })
    } catch (e) {
      console.error('Failed to create data directory:', e)
    }
  }

  providersPath = path.join(dataDir, 'providers.json')
  
  // Migration: Check for old file in root
  const oldPath = path.join(userDataPath, 'shade-providers.json')
  if (fs.existsSync(oldPath) && !fs.existsSync(providersPath)) {
    try {
      console.log('Migrating providers file to data directory...')
      fs.renameSync(oldPath, providersPath)
    } catch (e) {
      console.error('Failed to migrate providers file:', e)
      // Fallback to reading old path if move failed
      providersPath = oldPath
    }
  }

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
      providers = safeParseJson(data, null)
      if (!providers || typeof providers !== 'object') {
        throw new Error('Providers file contained invalid JSON')
      }

      // Migrate: Add any missing providers from defaults and update models
      let needsSave = false
      for (const [providerId, providerData] of Object.entries(defaultProviders)) {
        if (!providers[providerId]) {
          // Add completely new provider
          providers[providerId] = JSON.parse(JSON.stringify(providerData))
          needsSave = true
        } else {
          // Remove the retired Go availability gate from previously saved catalogs.
          if (providerId === 'opencode-go') {
            delete providers[providerId].disabled
            delete providers[providerId].disabledReason
            providers[providerId].description = providerData.description
            providers[providerId].verificationNotice = providerData.verificationNotice
            needsSave = true
          }
          // Update models for existing provider if default has more models
          const existingModels = providers[providerId].models || {}
          const defaultModels = providerData.models || {}

          // Add any missing models from defaults
          for (const [modelId, modelData] of Object.entries(defaultModels)) {
            if (!existingModels[modelId]) {
              existingModels[modelId] = JSON.parse(JSON.stringify(modelData))
              needsSave = true
            }
          }

          providers[providerId].models = existingModels

          // Migrate: ensure requiresApiKey exists for openai-compatible providers
          if (providerData.type === 'openai-compatible' && providers[providerId].requiresApiKey === undefined) {
            providers[providerId].requiresApiKey = providerData.requiresApiKey
            needsSave = true
          }
        }
      }

      // Save if we added any missing providers or models
      if (needsSave) {
        saveProviders()
      }
    } else {
      // Create default providers file
      providers = JSON.parse(JSON.stringify(defaultProviders))
      if (providersPath) {
        saveProviders()
      }
    }
  } catch (error) {
    console.error('Failed to load providers, using defaults:', error)
    providers = JSON.parse(JSON.stringify(defaultProviders))
  }
}

/**
 * Save providers to JSON file
 */
function saveProviders() {
  if (!providersPath) return

  try {
    writeFileAtomicSync(providersPath, JSON.stringify(providers, null, 2), 'utf8')
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
    providers = JSON.parse(JSON.stringify(defaultProviders))
  }
  return Object.keys(providers)
}

/**
 * Get all provider metadata
 * @returns {Object} All provider metadata
 */
function getAllProviders() {
  if (!providers) {
    providers = JSON.parse(JSON.stringify(defaultProviders))
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
    providers = JSON.parse(JSON.stringify(defaultProviders))
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
    providers = JSON.parse(JSON.stringify(defaultProviders))
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
function getModels(id, { visionOnly = false } = {}) {
  const provider = getProvider(id)
  if (!provider || !provider.models) return []

  // Convert models object to array format
  return Object.entries(provider.models).map(([modelId, modelMeta]) => ({
    ...modelMeta,
    id: modelId,
    name: modelMeta.name || modelId,
    capabilities: resolveCapabilities(provider, modelMeta)
  })).filter(model => !visionOnly || model.capabilities.vision === true)
}

function getModelCapabilities(providerId, modelId) {
  const provider = getProvider(providerId)
  return resolveCapabilities(provider || {}, provider?.models?.[modelId] || {})
}

function getDefaultModels(providerId) {
  return JSON.parse(JSON.stringify(defaultProviders[providerId]?.models || {}))
}

/**
 * Generate default providers config object for config-service
 * @returns {Object} Default providers config
 */
function generateDefaultProvidersConfig() {
  if (!providers) {
    providers = JSON.parse(JSON.stringify(defaultProviders))
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
    providers = JSON.parse(JSON.stringify(defaultProviders))
  }

  if (!providers[providerId]) {
    console.error(`Provider not found: ${providerId}`)
    return
  }

  // Update models and lastFetched timestamp
  if (!models || typeof models !== 'object' || Array.isArray(models) || !Object.keys(models).length) {
    throw new Error(`No models returned for ${providerId}; keeping the existing model cache`)
  }
  const existing = providers[providerId].models || {}
  providers[providerId].models = Object.fromEntries(Object.entries(models).map(([id, model]) => [
    id, mergeModelMetadata(existing[id] || defaultProviders[providerId]?.models?.[id], model)
  ]))
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
  getModelCapabilities,
  getDefaultModels,
  generateDefaultProvidersConfig,
  updateProviderModels
}
