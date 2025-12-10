const { GoogleGenerativeAI } = require('@google/generative-ai')
const LLMProvider = require('../llm-service')

/**
 * Google Gemini provider implementation
 * Uses the @google/generative-ai SDK (legacy, but stable)
 */
class GeminiProvider extends LLMProvider {
  constructor(apiKey, config = {}) {
    super(apiKey, config)

    // Default to gemini-2.5-flash (recommended model)
    this.modelName = config.model || 'gemini-2.5-flash'
    this.systemPrompt = config.systemPrompt || ''

    // Initialize Gemini client with system instruction if provided
    const modelConfig = { model: this.modelName }
    if (this.systemPrompt) {
      modelConfig.systemInstruction = this.systemPrompt
    }

    this.genAI = new GoogleGenerativeAI(apiKey)
    this.model = this.genAI.getGenerativeModel(modelConfig)
  }

  /**
   * Send a message with optional image to Gemini
   * @param {string} text - The text message to send
   * @param {string|null} imageBase64 - Optional base64-encoded image (without data:image prefix)
   * @returns {Promise<string>} - The complete response from Gemini
   */
  async sendMessage(text, imageBase64 = null) {
    try {
      let parts = [text]

      // If image is provided, add it to the request
      if (imageBase64) {
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64
          }
        })
      }

      const result = await this.model.generateContent(parts)
      const response = result.response
      return response.text()
    } catch (error) {
      throw new Error(`Gemini API error: ${error.message}`)
    }
  }

  /**
   * Stream a response from Gemini with optional image and conversation history
   * @param {string} text - The text message to send
   * @param {string|null} imageBase64 - Optional base64-encoded image
   * @param {Array} conversationHistory - Array of previous messages [{type: 'user'/'ai', text: string}]
   * @param {Function} onChunk - Callback function for each chunk of response
   * @returns {Promise<void>}
   */
  async streamResponse(text, imageBase64 = null, conversationHistory = [], onChunk) {
    try {
      const contents = []

      // Add conversation history (excluding the current message)
      for (const msg of conversationHistory) {
        // Map 'ai' type to 'model' role for Gemini
        const role = msg.type === 'user' ? 'user' : 'model'
        contents.push({
          role,
          parts: [{ text: msg.text }]
        })
      }

      // Add current message
      const parts = []

      // Add text first
      parts.push({ text })

      // If image is provided, add it to the request
      if (imageBase64) {
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64
          }
        })
      }

      contents.push({
        role: 'user',
        parts
      })

      const result = await this.model.generateContentStream({ contents })

      // Stream the response chunks
      for await (const chunk of result.stream) {
        const chunkText = chunk.text()
        if (chunkText) {
          onChunk(chunkText)
        }
      }
    } catch (error) {
      throw new Error(`Gemini streaming error: ${error.message}`)
    }
  }

  /**
   * Validate that the API key is valid by making a test request
   * @returns {Promise<boolean>} - True if valid, false otherwise
   */
  async validateApiKey() {
    try {
      // Simple test request with minimal token usage
      const result = await this.model.generateContent('Hi')
      result.response.text()
      return true
    } catch (error) {
      console.error('API key validation failed:', error.message)
      return false
    }
  }

  /**
   * Get list of available Gemini models
   * @returns {Array<{id: string, name: string}>} - List of model objects
   */
  getModels() {
    return [
      // Gemini 3 Series (Latest - Nov 2025)
      { id: 'gemini-3.0-pro', name: 'Gemini 3.0 Pro (Most Intelligent)' },
      { id: 'gemini-3.0-deep-think', name: 'Gemini 3.0 Deep Think' },

      // Gemini 2.5 Series (Production - Dec 2025)
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Complex Reasoning)' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Recommended)' },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite (High Throughput)' },
      { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image (Image Generation)' },

      // Gemini 2.0 Series
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },

      // Gemini 1.5 Series (Legacy)
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Legacy)' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Legacy)' }
    ]
  }

  /**
   * Get the provider name
   * @returns {string} - Provider name
   */
  getName() {
    return 'gemini'
  }
}

module.exports = GeminiProvider
