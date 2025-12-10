const OpenAI = require('openai')
const LLMProvider = require('../llm-service')

/**
 * OpenAI provider implementation
 * Uses the official openai SDK for GPT-4 Vision and text models
 */
class OpenAIProvider extends LLMProvider {
  constructor(apiKey, config = {}) {
    super(apiKey, config)

    // Default to gpt-4o (latest recommended multimodal model)
    this.modelName = config.model || 'gpt-4o'
    this.systemPrompt = config.systemPrompt || ''

    // Initialize OpenAI client
    this.client = new OpenAI({
      apiKey: apiKey
    })
  }

  /**
   * Send a message with optional image to OpenAI
   * @param {string} text - The text message to send
   * @param {string|null} imageBase64 - Optional base64-encoded image (without data:image prefix)
   * @returns {Promise<string>} - The complete response from OpenAI
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
        max_completion_tokens: 4096
      })

      return response.choices[0].message.content
    } catch (error) {
      throw new Error(`OpenAI API error: ${error.message}`)
    }
  }

  /**
   * Stream a response from OpenAI with optional image and conversation history
   * @param {string} text - The text message to send
   * @param {string|null} imageBase64 - Optional base64-encoded image
   * @param {Array} conversationHistory - Array of previous messages [{type: 'user'/'ai', text: string}]
   * @param {Function} onChunk - Callback function for each chunk of response
   * @returns {Promise<void>}
   */
  async streamResponse(text, imageBase64 = null, conversationHistory = [], onChunk) {
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
        // Map 'ai' type to 'assistant' role for OpenAI
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
        max_completion_tokens: 4096,
        stream: true
      })

      // Stream the response chunks
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          onChunk(content)
        }
      }
    } catch (error) {
      throw new Error(`OpenAI streaming error: ${error.message}`)
    }
  }

  /**
   * Validate that the API key is valid by making a test request
   * @returns {Promise<boolean>} - True if valid, false otherwise
   */
  async validateApiKey() {
    try {
      // Simple test request with minimal token usage
      await this.client.chat.completions.create({
        model: this.modelName,
        messages: [{ role: 'user', content: 'Hi' }],
        max_completion_tokens: 100
      })
      return true
    } catch (error) {
      console.error('API key validation failed:', error.message)
      return false
    }
  }

  /**
   * Get list of available OpenAI models
   * @returns {Array<{id: string, name: string}>} - List of model objects
   */
  getModels() {
    return [
      // GPT-5 Series (Reasoning Models - 2025)
      { id: 'gpt-5.1', name: 'GPT-5.1 (Flagship Reasoning)' },
      { id: 'gpt-5.1-chat', name: 'GPT-5.1 Chat' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini (Fast Reasoning)' },
      { id: 'gpt-5-nano', name: 'GPT-5 Nano (Fastest & Affordable)' },

      // GPT-4.1 Family (Apr 2025)
      { id: 'gpt-4.1', name: 'GPT-4.1 (Recommended - Latest)' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano (Fastest)' },

      // GPT-4o (Audio Support)
      { id: 'gpt-4o', name: 'GPT-4o (Audio I/O)' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },

      // Legacy Models
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo (Legacy)' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (Legacy)' }
    ]
  }

  /**
   * Get the provider name
   * @returns {string} - Provider name
   */
  getName() {
    return 'openai'
  }
}

module.exports = OpenAIProvider
