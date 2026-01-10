import { describe, test, expect } from 'vitest'

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

    test('should use exact provider names (case-sensitive)', () => {
      const provider = LLMFactory.createProvider('gemini', 'test-key')
      expect(provider.getName()).toBe('gemini')

      // Provider creation is case-sensitive (must match registry keys)
      expect(() => {
        LLMFactory.createProvider('GEMINI', 'test-key')
      }).toThrow('Unknown provider: GEMINI')
    })
  })

  describe('Provider Availability', () => {
    test('should return list of available providers', () => {
      const providers = LLMFactory.getAvailableProviders()

      expect(Array.isArray(providers)).toBe(true)
      expect(providers.length).toBeGreaterThan(0)
      expect(providers).toContain('gemini')
    })
  })

  describe('Multi-Provider Support', () => {
    test('should create OpenAI provider with valid API key', () => {
      const provider = LLMFactory.createProvider('openai', 'sk-test-key-123')
      expect(provider).toBeDefined()
      expect(provider.getName()).toBe('openai')
    })

    test('should create Anthropic provider with valid API key', () => {
      const provider = LLMFactory.createProvider('anthropic', 'sk-ant-test-key-123')
      expect(provider).toBeDefined()
      expect(provider.getName()).toBe('anthropic')
    })

    test('should create custom provider (OpenRouter) with API key', () => {
      const provider = LLMFactory.createProvider('openrouter', 'test-key')
      expect(provider).toBeDefined()
      expect(provider.getName()).toBe('custom')
    })

    test('should require API key for custom provider (OpenRouter)', () => {
      expect(() => {
        LLMFactory.createProvider('openrouter', '')
      }).toThrow('API key is required')
    })

    test('should create custom provider (Grok) with API key', () => {
      const provider = LLMFactory.createProvider('grok', 'test-key')
      expect(provider).toBeDefined()
      expect(provider.getName()).toBe('custom')
    })

    test('should require API key for custom provider (Grok)', () => {
      expect(() => {
        LLMFactory.createProvider('grok', '')
      }).toThrow('API key is required')
    })

    test('should create custom provider (Ollama) without API key', () => {
      // Ollama is local and doesn't require API key
      const provider = LLMFactory.createProvider('ollama', '')
      expect(provider).toBeDefined()
      expect(provider.getName()).toBe('custom')
    })

    test('should create custom provider (LM Studio) without API key', () => {
      // LM Studio is local and doesn't require API key
      const provider = LLMFactory.createProvider('lm-studio', '')
      expect(provider).toBeDefined()
      expect(provider.getName()).toBe('custom')
    })
  })

  describe('Provider Registry Integration', () => {
    test('should get provider metadata', () => {
      const geminiMeta = LLMFactory.getProviderMeta('gemini')
      expect(geminiMeta).toBeDefined()
      expect(geminiMeta.name).toBe('Google Gemini')
      expect(geminiMeta.type).toBe('gemini')
    })

    test('should get all providers metadata', () => {
      const allMeta = LLMFactory.getAllProvidersMeta()
      expect(allMeta).toBeDefined()
      expect(Object.keys(allMeta).length).toBeGreaterThan(0)
      expect(allMeta.gemini).toBeDefined()
      expect(allMeta.openai).toBeDefined()
      expect(allMeta.anthropic).toBeDefined()
    })

    test('should handle model-specific options', () => {
      // o1 models have special options like reasoningEffort
      const config = { model: 'o1' }
      const provider = LLMFactory.createProvider('openai', 'test-key', config)

      // Provider should be created successfully
      expect(provider).toBeDefined()
      expect(provider.config.model).toBe('o1')
    })
  })

  describe('OpenAI-Compatible Providers', () => {
    test('should create Grok provider with correct baseUrl', () => {
      const provider = LLMFactory.createProvider('grok', 'test-key')
      expect(provider).toBeDefined()
      expect(provider.config.baseUrl).toBe('https://api.x.ai/v1')
    })

    test('should create OpenRouter provider with correct baseUrl', () => {
      const provider = LLMFactory.createProvider('openrouter', 'test-key')
      expect(provider).toBeDefined()
      expect(provider.config.baseUrl).toBe('https://openrouter.ai/api/v1')
    })

    test('should create Ollama provider with local baseUrl', () => {
      const provider = LLMFactory.createProvider('ollama', '')
      expect(provider).toBeDefined()
      expect(provider.config.baseUrl).toBe('http://localhost:11434/v1')
    })

    test('should create LM Studio provider with local baseUrl', () => {
      const provider = LLMFactory.createProvider('lm-studio', '')
      expect(provider).toBeDefined()
      expect(provider.config.baseUrl).toBe('http://localhost:1234/v1')
    })
  })
})
