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
   * @param {AbortSignal|null} signal - Optional abort signal
   * @returns {Promise<void>}
   */
  async streamResponse(text, imageBase64 = null, conversationHistory = [], onChunk, signal = null) {
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

      // Note: Gemini SDK doesn't natively support AbortSignal in generateContentStream yet in some versions,
      // but we can wrap it or hope the fetch-based ones do.
      // For now we'll pass it if possible, or manually check it.
      const result = await this.model.generateContentStream({ contents })

      // Stream the response chunks
      for await (const chunk of result.stream) {
        if (signal?.aborted) {
          break;
        }
        const chunkText = chunk.text()
        if (chunkText) {
          onChunk(chunkText)
        }
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.message?.includes('abort')) {
        return; // Request was aborted
      }
      throw new Error(`Gemini streaming error: ${error.message}`)
    }
  }

  /**
   * Validate that the API key is valid by making a test request
   * @returns {Promise<boolean>} - True if valid, false otherwise
   */
  async validateApiKey() {
    try {
      // Use countTokens which is lightweight and doesn't consume generation quota
      await this.model.countTokens('Hi')
      return true
    } catch (error) {
      console.warn('Gemini countTokens validation failed, falling back to generateContent:', error.message)
      try {
        // Fallback to simple test request
        const result = await this.model.generateContent('Hi')
        result.response.text()
        return true
      } catch (inner) {
        console.error('API key validation failed:', inner.message)
        return false
      }
    }
  }

  /**
   * Get list of available Gemini models
   * @returns {Array<{id: string, name: string}>} - List of model objects
   */
  getModels() { return super.getModels() }

  /**
   * Get the provider name
   * @returns {string} - Provider name
   */
  getName() {
    return 'gemini'
  }
}

module.exports = GeminiProvider
