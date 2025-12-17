const https = require('https')
const http = require('http')
const ProviderRegistry = require('./provider-registry')

/**
 * Service for refreshing model lists from provider APIs
 * Supports caching with 7-day TTL and vision-only filtering
 */
class ModelRefreshService {
  constructor() {
    this.CACHE_TTL_DAYS = 7
  }

  /**
   * Check if a provider's model cache is stale (> 7 days old)
   * @param {string} providerId - Provider ID
   * @returns {boolean} True if cache is stale or doesn't exist
   */
  isCacheStale(providerId) {
    const provider = ProviderRegistry.getProvider(providerId)
    if (!provider || !provider.lastFetched) {
      return true
    }

    const lastFetched = new Date(provider.lastFetched)
    const now = new Date()
    const daysSinceLastFetch = (now - lastFetched) / (1000 * 60 * 60 * 24)

    return daysSinceLastFetch > this.CACHE_TTL_DAYS
  }

  /**
   * Refresh models for a specific provider
   * @param {string} providerId - Provider ID
   * @param {string} apiKey - API key (optional for some providers)
   * @returns {Promise<{success: boolean, models: Object, error?: string}>}
   */
  async refreshModels(providerId, apiKey = '') {
    const provider = ProviderRegistry.getProvider(providerId)
    if (!provider) {
      return { success: false, error: `Unknown provider: ${providerId}` }
    }

    try {
      let models = {}

      switch (provider.type) {
        case 'gemini':
          models = await this.fetchGeminiModels(apiKey)
          break
        case 'openai':
          models = await this.fetchOpenAIModels(apiKey)
          break
        case 'anthropic':
          models = await this.fetchAnthropicModels()
          break
        case 'openai-compatible':
          models = await this.fetchOpenAICompatibleModels(providerId, provider.baseUrl, apiKey)
          break
        default:
          return { success: false, error: `Unsupported provider type: ${provider.type}` }
      }

      // Update provider registry with new models
      ProviderRegistry.updateProviderModels(providerId, models)

      return { success: true, models }
    } catch (error) {
      console.error(`Error refreshing models for ${providerId}:`, error)
      return { success: false, error: error.message }
    }
  }

  /**
   * Fetch models from Gemini API (all Gemini models support vision)
   * @param {string} apiKey - Gemini API key
   * @returns {Promise<Object>} Models object
   */
  async fetchGeminiModels(apiKey) {
    if (!apiKey) {
      throw new Error('API key required for Gemini')
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    const response = await this.httpsRequest(url)
    const data = JSON.parse(response)

    const models = {}
    if (data.models && Array.isArray(data.models)) {
      // Filter for models that support generateContent (chat/vision)
      data.models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .forEach(model => {
          // Extract model ID (e.g., "models/gemini-2.0-flash-exp" -> "gemini-2.0-flash-exp")
          const modelId = model.name.replace('models/', '')
          models[modelId] = {
            name: model.displayName || modelId
          }
        })
    }

    return models
  }

  /**
   * Fetch models from OpenAI API and filter for vision-capable ones
   * @param {string} apiKey - OpenAI API key
   * @returns {Promise<Object>} Models object
   */
  async fetchOpenAIModels(apiKey) {
    if (!apiKey) {
      throw new Error('API key required for OpenAI')
    }

    const response = await this.httpsRequest('https://api.openai.com/v1/models', {
      'Authorization': `Bearer ${apiKey}`
    })
    const data = JSON.parse(response)

    const models = {}
    if (data.data && Array.isArray(data.data)) {
      // Filter for vision-capable models
      data.data
        .filter(m => this.isOpenAIVisionModel(m.id))
        .forEach(model => {
          models[model.id] = {
            name: this.formatModelName(model.id)
          }

          // Add model-specific options for reasoning models
          if (model.id.startsWith('o1') || model.id.startsWith('o3') || model.id.startsWith('o4')) {
            models[model.id].options = {
              reasoningEffort: 'high'
            }
          }
        })
    }

    return models
  }

  /**
   * Check if an OpenAI model supports vision
   * @param {string} modelId - Model ID
   * @returns {boolean}
   */
  isOpenAIVisionModel(modelId) {
    const visionKeywords = [
      'gpt-4o',
      'gpt-4.1',
      'gpt-4.5',
      'gpt-5',
      'gpt-4-turbo',
      'gpt-4-vision'
    ]

    // Check for vision keywords or o-series models
    return visionKeywords.some(keyword => modelId.includes(keyword)) ||
           modelId.match(/^o\d/)
  }

  /**
   * Fetch Claude models (manually maintained - no public API)
   * Returns current list from community knowledge
   * @returns {Promise<Object>} Models object
   */
  async fetchAnthropicModels() {
    // Anthropic doesn't provide a public model list API
    // Return manually curated list of vision-capable models (all Claude models support vision)
    return {
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
  }

  /**
   * Fetch models from OpenAI-compatible endpoints
   * @param {string} providerId - Provider ID
   * @param {string} baseUrl - Base URL
   * @param {string} apiKey - API key (optional)
   * @returns {Promise<Object>} Models object
   */
  async fetchOpenAICompatibleModels(providerId, baseUrl, apiKey = '') {
    // Special handling for local providers
    if (providerId === 'ollama') {
      return this.fetchOllamaModels(baseUrl)
    }

    if (providerId === 'openrouter') {
      return this.fetchOpenRouterModels(apiKey)
    }

    // Generic OpenAI-compatible endpoint
    try {
      const modelsUrl = baseUrl.replace(/\/$/, '') + '/models'
      const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}

      const protocol = baseUrl.startsWith('https') ? https : http
      const response = await this.request(modelsUrl, headers, protocol)
      const data = JSON.parse(response)

      const models = {}
      if (data.data && Array.isArray(data.data)) {
        data.data.forEach(model => {
          models[model.id] = {
            name: this.formatModelName(model.id)
          }
        })
      }

      return models
    } catch (error) {
      console.warn(`Could not fetch models from ${baseUrl}:`, error.message)
      return {}
    }
  }

  /**
   * Fetch models from Ollama local API
   * @param {string} baseUrl - Ollama base URL
   * @returns {Promise<Object>} Models object
   */
  async fetchOllamaModels(baseUrl) {
    try {
      // Ollama uses /api/tags endpoint
      const tagsUrl = baseUrl.replace('/v1', '').replace(/\/$/, '') + '/api/tags'
      const response = await this.request(tagsUrl, {}, http)
      const data = JSON.parse(response)

      const models = {}
      if (data.models && Array.isArray(data.models)) {
        // Filter for vision-capable models (llava, bakllava, llama3.2-vision, etc.)
        data.models
          .filter(m => this.isOllamaVisionModel(m.name))
          .forEach(model => {
            models[model.name] = {
              name: this.formatModelName(model.name)
            }
          })
      }

      return models
    } catch (error) {
      console.warn('Could not fetch Ollama models:', error.message)
      return {}
    }
  }

  /**
   * Check if an Ollama model supports vision
   * @param {string} modelName - Model name
   * @returns {boolean}
   */
  isOllamaVisionModel(modelName) {
    const visionModels = ['llava', 'bakllava', 'llama3.2-vision', 'minicpm-v']
    return visionModels.some(vm => modelName.toLowerCase().includes(vm))
  }

  /**
   * Fetch models from OpenRouter API
   * @param {string} apiKey - OpenRouter API key (optional)
   * @returns {Promise<Object>} Models object
   */
  async fetchOpenRouterModels(apiKey = '') {
    try {
      const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
      const response = await this.httpsRequest('https://openrouter.ai/api/v1/models', headers)
      const data = JSON.parse(response)

      const models = {}
      if (data.data && Array.isArray(data.data)) {
        // Filter for vision-capable models
        data.data
          .filter(m => m.architecture?.modality?.includes('image'))
          .forEach(model => {
            models[model.id] = {
              name: model.name || this.formatModelName(model.id)
            }
          })
      }

      return models
    } catch (error) {
      console.warn('Could not fetch OpenRouter models:', error.message)
      return {}
    }
  }

  /**
   * Format model ID into a readable name
   * @param {string} modelId - Model ID
   * @returns {string} Formatted name
   */
  formatModelName(modelId) {
    return modelId
      .split(/[-_\/]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  /**
   * Make HTTPS request
   * @param {string} url - URL to fetch
   * @param {Object} headers - HTTP headers
   * @returns {Promise<string>} Response body
   */
  httpsRequest(url, headers = {}) {
    return this.request(url, headers, https)
  }

  /**
   * Make HTTP/HTTPS request
   * @param {string} url - URL to fetch
   * @param {Object} headers - HTTP headers
   * @param {Object} protocol - http or https module
   * @returns {Promise<string>} Response body
   */
  request(url, headers = {}, protocol = https) {
    return new Promise((resolve, reject) => {
      const req = protocol.get(url, { headers }, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data)
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`))
          }
        })
      })

      req.on('error', (error) => {
        reject(error)
      })

      req.setTimeout(10000, () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })
    })
  }
}

module.exports = new ModelRefreshService()
