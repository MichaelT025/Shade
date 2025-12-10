import { describe, test, expect, beforeEach } from 'vitest'

// Import the factory
const LLMFactory = (await import('../llm-factory.js')).default

describe('LLMFactory', () => {
  describe('Provider Creation', () => {
    test('should create Gemini provider with valid API key', () => {
      const provider = LLMFactory.createProvider('gemini', 'test-api-key-123')

      expect(provider).toBeDefined()
      expect(provider.getName()).toBe('gemini')
    })

    test('should create Gemini provider with custom config', () => {
      const config = { model: 'gemini-2.0-flash' }
      const provider = LLMFactory.createProvider('gemini', 'test-api-key', config)

      expect(provider).toBeDefined()
      expect(provider.config.model).toBe('gemini-2.0-flash')
    })

    test('should throw error when API key is missing', () => {
      expect(() => {
        LLMFactory.createProvider('gemini', '')
      }).toThrow('API key is required')
    })

    test('should throw error when API key is null', () => {
      expect(() => {
        LLMFactory.createProvider('gemini', null)
      }).toThrow('API key is required')
    })

    test('should throw error for unsupported provider', () => {
      expect(() => {
        LLMFactory.createProvider('invalid-provider', 'test-key')
      }).toThrow('Unknown provider: invalid-provider')
    })

    test('should handle case-insensitive provider names', () => {
      const provider1 = LLMFactory.createProvider('gemini', 'test-key')
      const provider2 = LLMFactory.createProvider('GEMINI', 'test-key')
      const provider3 = LLMFactory.createProvider('Gemini', 'test-key')

      expect(provider1.getName()).toBe('gemini')
      expect(provider2.getName()).toBe('gemini')
      expect(provider3.getName()).toBe('gemini')
    })
  })

  describe('Provider Availability', () => {
    test('should return list of available providers', () => {
      const providers = LLMFactory.getAvailableProviders()

      expect(Array.isArray(providers)).toBe(true)
      expect(providers.length).toBeGreaterThan(0)
      expect(providers).toContain('gemini')
    })

    test('should check if Gemini is supported', () => {
      expect(LLMFactory.isProviderSupported('gemini')).toBe(true)
    })

    test('should check if unsupported provider returns false', () => {
      expect(LLMFactory.isProviderSupported('invalid')).toBe(false)
    })

    test('should handle case-insensitive provider check', () => {
      expect(LLMFactory.isProviderSupported('GEMINI')).toBe(true)
      expect(LLMFactory.isProviderSupported('Gemini')).toBe(true)
    })
  })

  describe('Future Provider Placeholders', () => {
    test('should not support OpenAI yet', () => {
      expect(LLMFactory.isProviderSupported('openai')).toBe(false)
    })

    test('should not support Anthropic yet', () => {
      expect(LLMFactory.isProviderSupported('anthropic')).toBe(false)
    })

    test('should throw error when trying to create OpenAI provider', () => {
      expect(() => {
        LLMFactory.createProvider('openai', 'test-key')
      }).toThrow('Unknown provider: openai')
    })

    test('should throw error when trying to create Anthropic provider', () => {
      expect(() => {
        LLMFactory.createProvider('anthropic', 'test-key')
      }).toThrow('Unknown provider: anthropic')
    })
  })
})
