const GeminiProvider = require('./providers/gemini-provider')
const OpenAIProvider = require('./providers/openai-provider')
const AnthropicProvider = require('./providers/anthropic-provider')
const CustomProvider = require('./providers/custom-provider')
const ProviderRegistry = require('./provider-registry')
const { GatewayProvider } = require('./providers/gateway-provider')
const { version } = require('../../package.json')

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
    if (providerMeta.disabled) throw new Error(providerMeta.disabledReason || 'This provider is not available')

    // Get model-specific options if defined
    const selectedModel = config.model || providerMeta.defaultModel || ''
    const model = providerMeta.modelAliases?.[selectedModel] || selectedModel
    const modelOptions = providerMeta.models?.[model]?.options || {}

    // Merge config with model-specific options
    const finalConfig = { ...config, model, ...modelOptions, providerId: providerName }

    const requiresApiKey = providerMeta.requiresApiKey !== undefined
      ? providerMeta.requiresApiKey
      : providerMeta.type !== 'openai-compatible'

    if (requiresApiKey && !apiKey) {
      throw new Error(`API key is required for provider: ${providerName}`)
    }

    // Use provider's 'type' field to determine which SDK to instantiate
    switch (providerMeta.type) {
      case 'gateway': {
        if (!providerMeta.models?.[model]) throw new Error(`Model ${model} is unavailable. Refresh models and choose another model.`)
        if (providerName === 'opencode-go' && !(typeof config.conversationId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(config.conversationId))) throw new Error('OpenCode Go requires a conversation session ID')
        return new GatewayProvider(apiKey, { ...finalConfig,
          baseUrl: providerMeta.baseUrl, protocol: providerMeta.models[model].protocol,
          capabilities: ProviderRegistry.getModelCapabilities(providerName, model),
          defaultHeaders: { 'User-Agent': `shade/${version}`,
            ...(providerName === 'opencode-go' ? { 'x-opencode-session': config.conversationId } : {}) }
        })
      }
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
