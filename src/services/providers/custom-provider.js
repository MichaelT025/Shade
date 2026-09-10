const OpenAI = require('openai')
const LLMProvider = require('../llm-service')

/**
 * Custom OpenAI-compatible provider implementation
 * Works with local providers like Ollama, LM Studio, etc.
 */
class CustomProvider extends LLMProvider {
  constructor(apiKey, config = {}) {
    super(apiKey, config)

    // Default to first available model or empty string
    this.modelName = config.model || ''
    this.systemPrompt = config.systemPrompt || ''

    // Initialize OpenAI client with custom base URL
    this.client = new OpenAI({
      apiKey: apiKey || 'not-needed', // Some local providers don't need API keys
      baseURL: config.baseUrl || 'http://localhost:11434/v1'
    })
  }

  /**
   * Send a message with optional image to the custom provider
   * @param {string} text - The text message to send
   * @param {string|null} imageBase64 - Optional base64-encoded image (without data:image prefix)
   * @returns {Promise<string>} - The complete response
   */
  async sendMessage(text, imageBase64 = null) {
    try {
      const messages = []

      // Build message content
      if (imageBase64) {
        // Multimodal message (text + image)
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: text
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`
              }
            }
          ]
        })
      } else {
        // Text-only message
        messages.push({
          role: 'user',
          content: text
        })
      }

      const response = await this.client.chat.completions.create({
        model: this.modelName,
        messages: messages,
        max_tokens: 4096
      })

      return response.choices[0].message.content
    } catch (error) {
      throw new Error(`Custom provider API error: ${error.message}`)
    }
  }

  /**
   * Stream a response from the custom provider with optional image and conversation history
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

      // Add system prompt if configured
      if (this.systemPrompt) {
        messages.push({
          role: 'system',
          content: this.systemPrompt
        })
      }

      // Add conversation history (excluding the current message)
      for (const msg of conversationHistory) {
        // Map 'ai' type to 'assistant' role for OpenAI API
        const role = msg.type === 'user' ? 'user' : 'assistant'
        messages.push({
          role,
          content: msg.text
        })
      }

      // Build current message content
      if (imageBase64) {
        // Multimodal message (text + image)
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: text
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`
              }
            }
          ]
        })
      } else {
        // Text-only message
        messages.push({
          role: 'user',
          content: text
        })
      }

      const stream = await this.client.chat.completions.create({
        model: this.modelName,
        messages: messages,
        max_tokens: 4096,
        stream: true
      }, { signal })

      // Stream the response chunks
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          onChunk(content)
        }
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) {
        return; // Request was aborted
      }
      throw new Error(`Custom provider streaming error: ${error.message}`)
    }
  }

  /**
   * Validate that the API connection is working by making a test request
   * @returns {Promise<boolean>} - True if valid, false otherwise
   */
  async validateApiKey() {
    try {
      // Prefer a non-billable endpoint (no token usage).
      await this.client.models.list()
      return true
    } catch (error) {
      // Fallback: some OpenAI-compatible servers may not implement /models.
      try {
        await this.client.chat.completions.create({
          model: this.modelName,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 20
        })
        return true
      } catch (inner) {
        console.error('Custom provider validation failed:', inner.message || error.message)
        return false
      }
    }
  }

  /**
   * Get list of available models
   * Note: For custom providers, this should be populated from the provider registry
   * @returns {Array<{id: string, name: string}>} - List of model objects
   */
  getModels() { return super.getModels() }

  /**
   * Get the provider name
   * @returns {string} - Provider name
   */
  getName() {
    return 'custom'
  }
}

module.exports = CustomProvider
