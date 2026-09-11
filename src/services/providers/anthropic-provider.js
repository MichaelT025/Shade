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
   * @param {AbortSignal|null} signal - Optional abort signal
   * @returns {Promise<void>}
   */
  async streamResponse(text, imageBase64 = null, conversationHistory = [], onChunk, signal = null) {
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

      const stream = await this.client.messages.create(requestParams, { signal })

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
      if (error.name === 'AbortError' || error.message?.includes('abort')) {
        return; // Request was aborted
      }
      throw new Error(`Anthropic streaming error: ${error.message}`)
    }
  }

  /**
   * Validate that the API key is valid by making a test request
   * @returns {Promise<boolean>} - True if valid, false otherwise
   */
  async validateApiKey() {
    try {
      // Prefer a non-billable endpoint (no token usage) when supported.
      if (this.client.models?.list) {
        await this.client.models.list()
        return true
      }

      // Fallback for older SDKs.
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
  getModels() { return super.getModels() }

  /**
   * Get the provider name
   * @returns {string} - Provider name
   */
  getName() {
    return 'anthropic'
  }
}

module.exports = AnthropicProvider
