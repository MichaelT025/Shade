/**
 * Abstract base class for LLM providers
 * All provider implementations must extend this class and implement its methods
 */
class LLMProvider {
  /**
   * @param {string} apiKey - API key for the provider (optional for local providers)
   * @param {Object} config - Provider-specific configuration (model, temperature, etc.)
   */
  constructor(apiKey, config = {}) {
    // API key is optional for local providers (ollama, lm-studio, etc.)
    this.apiKey = apiKey || ''
    this.config = config
  }

  /**
   * Send a message with optional image to the LLM
   * @param {string} text - The text message to send
   * @param {string|null} imageBase64 - Optional base64-encoded image
   * @returns {Promise<string>} - The complete response from the LLM
   */
  async sendMessage(text, imageBase64 = null) {
    throw new Error('sendMessage() must be implemented by provider')
  }

  /**
   * Stream a response from the LLM with optional image
   * @param {string} text - The text message to send
   * @param {string|null} imageBase64 - Optional base64-encoded image
   * @param {Array} conversationHistory - Array of previous messages [{type: 'user'/'ai', text: string}]
   * @param {Function} onChunk - Callback function for each chunk of response
   * @param {AbortSignal|null} signal - Optional abort signal to interrupt the request
   * @returns {Promise<void>}
   */
  async streamResponse(text, imageBase64 = null, conversationHistory = [], onChunk, signal = null) {
    throw new Error('streamResponse() must be implemented by provider')
  }

  /**
   * Validate that the API key is valid by making a test request
   * @returns {Promise<boolean>} - True if valid, false otherwise
   */
  async validateApiKey() {
    throw new Error('validateApiKey() must be implemented by provider')
  }

  /**
   * Get list of available models for this provider
   * @returns {Array<{id: string, name: string}>} - List of model objects
   */
  getModels() {
    const registry = require('./provider-registry')
    return registry.getModels(this.config.providerId || this.getName())
  }

  /**
   * Get the provider name
   * @returns {string} - Provider name (e.g., 'gemini', 'openai', 'anthropic')
   */
  getName() {
    throw new Error('getName() must be implemented by provider')
  }
}

module.exports = LLMProvider
