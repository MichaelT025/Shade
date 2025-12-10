const GeminiProvider = require('./providers/gemini-provider')
const OpenAIProvider = require('./providers/openai-provider')
const AnthropicProvider = require('./providers/anthropic-provider')

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
    if (!apiKey) {
      throw new Error(`API key is required for provider: ${providerName}`)
    }

    switch (providerName.toLowerCase()) {
      case 'gemini':
        return new GeminiProvider(apiKey, config)

      case 'openai':
        return new OpenAIProvider(apiKey, config)

      case 'anthropic':
        return new AnthropicProvider(apiKey, config)

      // Future providers:
      // case 'custom':
      //   return new CustomProvider(apiKey, config)

      default:
        throw new Error(`Unknown provider: ${providerName}`)
    }
  }

  /**
   * Get list of available provider names
   * @returns {Array<string>} - List of provider names
   */
  static getAvailableProviders() {
    return [
      'gemini',
      'openai',
      'anthropic'
    ]
  }

  /**
   * Check if a provider is supported
   * @param {string} providerName - Provider name to check
   * @returns {boolean} - True if supported
   */
  static isProviderSupported(providerName) {
    return this.getAvailableProviders().includes(providerName.toLowerCase())
  }
}

module.exports = LLMFactory
