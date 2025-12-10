const Anthropic = require('@anthropic-ai/sdk')
const LLMProvider = require('../llm-service')

/**
 * Anthropic Claude provider implementation
 * Uses the official @anthropic-ai/sdk for Claude models
 */
class AnthropicProvider extends LLMProvider {
  constructor(apiKey, config = {}) {
    super(apiKey, config)

    // Default to Claude Haiku 4.5 (fastest and cheapest)
    this.modelName = config.model || 'claude-haiku-4-5'
    this.systemPrompt = config.systemPrompt || ''

    // Initialize Anthropic client
    this.client = new Anthropic({
      apiKey: apiKey
    })
  }

  /**
   * Send a message with optional image to Claude
   * @param {string} text - The text message to send
   * @param {string|null} imageBase64 - Optional base64-encoded image (without data:image prefix)
   * @returns {Promise<string>} - The complete response from Claude
   */
  async sendMessage(text, imageBase64 = null) {
    try {
      const content = []

      // Add image if provided
      if (imageBase64) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: imageBase64
          }
        })
      }

      // Add text
      content.push({
        type: 'text',
        text: text
      })

      const response = await this.client.messages.create({
        model: this.modelName,
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: content
        }]
      })

      // Extract text from response
      return response.content[0].text
    } catch (error) {
      throw new Error(`Anthropic API error: ${error.message}`)
    }
  }

  /**
   * Stream a response from Claude with optional image and conversation history
   * @param {string} text - The text message to send
   * @param {string|null} imageBase64 - Optional base64-encoded image
   * @param {Array} conversationHistory - Array of previous messages [{type: 'user'/'ai', text: string}]
   * @param {Function} onChunk - Callback function for each chunk of response
   * @returns {Promise<void>}
   */
  async streamResponse(text, imageBase64 = null, conversationHistory = [], onChunk) {
    try {
      const messages = []

      // Add conversation history (excluding the current message)
      for (const msg of conversationHistory) {
        // Map 'ai' type to 'assistant' role for Anthropic
        const role = msg.type === 'user' ? 'user' : 'assistant'
        messages.push({
          role,
          content: msg.text
        })
      }

      // Build current message content
      const content = []

      // Add image if provided
      if (imageBase64) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: imageBase64
          }
        })
      }

      // Add text
      content.push({
        type: 'text',
        text: text
      })

      messages.push({
        role: 'user',
        content: content
      })

      const requestParams = {
        model: this.modelName,
        max_tokens: 4096,
        messages: messages,
        stream: true
      }

      // Add system prompt if configured
      if (this.systemPrompt) {
        requestParams.system = this.systemPrompt
      }

      const stream = await this.client.messages.create(requestParams)

      // Stream the response chunks
      for await (const messageStreamEvent of stream) {
        if (messageStreamEvent.type === 'content_block_delta') {
          const delta = messageStreamEvent.delta
          if (delta.type === 'text_delta' && delta.text) {
            onChunk(delta.text)
          }
        }
      }
    } catch (error) {
      throw new Error(`Anthropic streaming error: ${error.message}`)
    }
  }

  /**
   * Validate that the API key is valid by making a test request
   * @returns {Promise<boolean>} - True if valid, false otherwise
   */
  async validateApiKey() {
    try {
      // Simple test request with minimal token usage
      await this.client.messages.create({
        model: this.modelName,
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: 'Hi'
        }]
      })
      return true
    } catch (error) {
      console.error('API key validation failed:', error.message)
      return false
    }
  }

  /**
   * Get list of available Anthropic models
   * @returns {Array<{id: string, name: string}>} - List of model objects
   */
  getModels() {
    return [
      // Claude 4.x Series (Current - 2025)
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5 (Most Intelligent - Nov 2025)' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (Best Coding - Recommended)' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (Fastest & Cheapest)' },
      { id: 'claude-opus-4-1', name: 'Claude Opus 4.1 (Agentic Tasks)' },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4 (Production)' },

      // Claude 3.x Series (Legacy - Being Deprecated)
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet v2 (Legacy)' },
      { id: 'claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet v1 (Legacy)' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (Legacy)' }
    ]
  }

  /**
   * Get the provider name
   * @returns {string} - Provider name
   */
  getName() {
    return 'anthropic'
  }
}

module.exports = AnthropicProvider
