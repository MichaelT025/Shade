const GeminiProvider = require('./providers/gemini-provider')
const OpenAIProvider = require('./providers/openai-provider')
const AnthropicProvider = require('./providers/anthropic-provider')
const CustomProvider = require('./providers/custom-provider')
const ProviderRegistry = require('./provider-registry')

/**
 * Factory for creating LLM provider instances
 */
class LLMFactory {
  /**
   * Create a provider instance based on provider name
   * @param {string} providerName - Name of the provider ('gemini', 'openai', 'anthropic', etc.)
   * @param {string} apiKey - API key for the provider
   * @param {Object} config - Provider-specific configuration
   * @returns {LLMProvider} - Provider instance
   */
  static createProvider(providerName, apiKey, config = {}) {
    // Get provider metadata from registry
    const providerMeta = ProviderRegistry.getProvider(providerName)
    if (!providerMeta) {
      throw new Error(`Unknown provider: ${providerName}`)
    }

    // Get model-specific options if defined
    const modelOptions = providerMeta.models?.[config.model]?.options || {}

    // Merge config with model-specific options
    const finalConfig = { ...config, ...modelOptions }

    const requiresApiKey = providerMeta.requiresApiKey !== undefined
      ? providerMeta.requiresApiKey
      : providerMeta.type !== 'openai-compatible'

    if (requiresApiKey && !apiKey) {
      throw new Error(`API key is required for provider: ${providerName}`)
    }

    // Use provider's 'type' field to determine which SDK to instantiate
    switch (providerMeta.type) {
      case 'gemini':
        return new GeminiProvider(apiKey, finalConfig)

      case 'openai':
        return new OpenAIProvider(apiKey, finalConfig)

      case 'anthropic':
        return new AnthropicProvider(apiKey, finalConfig)

      case 'openai-compatible':
        // Use CustomProvider with baseUrl from provider metadata
        return new CustomProvider(apiKey, {
          ...finalConfig,
          baseUrl: providerMeta.baseUrl
        })

      default:
        throw new Error(`Unsupported provider type: ${providerMeta.type}`)
    }
  }

  /**
   * Get provider metadata by ID
   * @param {string} providerName - Provider name
   * @returns {Object} - Provider metadata
   */
  static getProviderMeta(providerName) {
    return ProviderRegistry.getProvider(providerName)
  }

  /**
   * Get all provider metadata
   * @returns {Object} - All provider metadata
   */
  static getAllProvidersMeta() {
    return ProviderRegistry.getAllProviders()
  }

  /**
   * Get list of available provider names
   * @returns {Array<string>} - List of provider names
   */
  static getAvailableProviders() {
    return ProviderRegistry.getProviderIds()
  }
}

module.exports = LLMFactory
