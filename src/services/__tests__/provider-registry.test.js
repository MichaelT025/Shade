import { describe, test, expect, beforeEach } from 'vitest'

// Import ProviderRegistry
const ProviderRegistry = await import('../provider-registry.js')

describe('ProviderRegistry', () => {
  describe('Provider IDs', () => {
    test('should return array of provider IDs', () => {
      const providerIds = ProviderRegistry.getProviderIds()

      expect(Array.isArray(providerIds)).toBe(true)
      expect(providerIds.length).toBeGreaterThan(0)
    })

    test('should include all main providers', () => {
      const providerIds = ProviderRegistry.getProviderIds()

      expect(providerIds).toContain('gemini')
      expect(providerIds).toContain('openai')
      expect(providerIds).toContain('anthropic')
      expect(providerIds).toContain('grok')
      expect(providerIds).toContain('openrouter')
      expect(providerIds).toContain('ollama')
      expect(providerIds).toContain('lm-studio')
    })
  })

  describe('Provider Existence Check', () => {
    test('should return true for existing providers', () => {
      expect(ProviderRegistry.hasProvider('gemini')).toBe(true)
      expect(ProviderRegistry.hasProvider('openai')).toBe(true)
      expect(ProviderRegistry.hasProvider('anthropic')).toBe(true)
    })

    test('should return false for non-existent providers', () => {
      expect(ProviderRegistry.hasProvider('nonexistent')).toBe(false)
      expect(ProviderRegistry.hasProvider('invalid-provider')).toBe(false)
    })

    test('should be case-insensitive', () => {
      expect(ProviderRegistry.hasProvider('GEMINI')).toBe(true)
      expect(ProviderRegistry.hasProvider('Gemini')).toBe(true)
      expect(ProviderRegistry.hasProvider('OpenAI')).toBe(true)
    })

    test('should handle null and undefined', () => {
      expect(ProviderRegistry.hasProvider(null)).toBe(false)
      expect(ProviderRegistry.hasProvider(undefined)).toBe(false)
    })
  })

  describe('Getting Provider Metadata', () => {
    test('should get Gemini provider metadata', () => {
      const gemini = ProviderRegistry.getProvider('gemini')

      expect(gemini).toBeDefined()
      expect(gemini.name).toBe('Google Gemini')
      expect(gemini.type).toBe('gemini')
      expect(gemini.description).toContain('vision')
      expect(gemini.website).toBeDefined()
      expect(gemini.defaultModel).toBeDefined()
      expect(gemini.models).toBeDefined()
    })

    test('should get OpenAI provider metadata', () => {
      const openai = ProviderRegistry.getProvider('openai')

      expect(openai).toBeDefined()
      expect(openai.name).toBe('OpenAI')
      expect(openai.type).toBe('openai')
      expect(openai.defaultModel).toBe('gpt-4o')
      expect(openai.models).toBeDefined()
    })

    test('should get Anthropic provider metadata', () => {
      const anthropic = ProviderRegistry.getProvider('anthropic')

      expect(anthropic).toBeDefined()
      expect(anthropic.name).toBe('Anthropic Claude')
      expect(anthropic.type).toBe('anthropic')
      expect(anthropic.defaultModel).toBe('claude-sonnet-4-5')
    })

    test('should get Grok provider metadata with baseUrl', () => {
      const grok = ProviderRegistry.getProvider('grok')

      expect(grok).toBeDefined()
      expect(grok.name).toBe('Grok (X.AI)')
      expect(grok.type).toBe('openai-compatible')
      expect(grok.baseUrl).toBe('https://api.x.ai/v1')
    })

    test('should get OpenRouter provider metadata', () => {
      const openrouter = ProviderRegistry.getProvider('openrouter')

      expect(openrouter).toBeDefined()
      expect(openrouter.type).toBe('openai-compatible')
      expect(openrouter.baseUrl).toBe('https://openrouter.ai/api/v1')
    })

    test('should get Ollama provider metadata', () => {
      const ollama = ProviderRegistry.getProvider('ollama')

      expect(ollama).toBeDefined()
      expect(ollama.type).toBe('openai-compatible')
      expect(ollama.baseUrl).toBe('http://localhost:11434/v1')
    })

    test('should get LM Studio provider metadata', () => {
      const lmStudio = ProviderRegistry.getProvider('lm-studio')

      expect(lmStudio).toBeDefined()
      expect(lmStudio.type).toBe('openai-compatible')
      expect(lmStudio.baseUrl).toBe('http://localhost:1234/v1')
    })

    test('should return null for non-existent provider', () => {
      const provider = ProviderRegistry.getProvider('non-existent')
      expect(provider).toBeNull()
    })
  })

  describe('Getting All Providers', () => {
    test('should return all providers metadata', () => {
      const allProviders = ProviderRegistry.getAllProviders()

      expect(allProviders).toBeDefined()
      expect(typeof allProviders).toBe('object')
      expect(Object.keys(allProviders).length).toBeGreaterThan(0)
    })

    test('should include all main providers in getAllProviders', () => {
      const allProviders = ProviderRegistry.getAllProviders()

      expect(allProviders.gemini).toBeDefined()
      expect(allProviders.openai).toBeDefined()
      expect(allProviders.anthropic).toBeDefined()
      expect(allProviders.grok).toBeDefined()
      expect(allProviders.openrouter).toBeDefined()
      expect(allProviders.ollama).toBeDefined()
      expect(allProviders['lm-studio']).toBeDefined()
    })
  })

  describe('Getting Provider Models', () => {
    test('should get Gemini models', () => {
      const models = ProviderRegistry.getModels('gemini')

      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)

      const modelIds = models.map(m => m.id)
      expect(modelIds).toContain('gemini-2.0-flash-exp')
      expect(modelIds).toContain('gemini-1.5-flash')
      expect(modelIds).toContain('gemini-1.5-pro')
    })

    test('should get OpenAI models', () => {
      const models = ProviderRegistry.getModels('openai')

      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)

      const modelIds = models.map(m => m.id)
      expect(modelIds).toContain('gpt-4o')
      expect(modelIds).toContain('gpt-4o-mini')
      expect(modelIds).toContain('o1')
    })

    test('should get Anthropic models', () => {
      const models = ProviderRegistry.getModels('anthropic')

      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBeGreaterThan(0)

      const modelIds = models.map(m => m.id)
      expect(modelIds).toContain('claude-sonnet-4-5')
      expect(modelIds).toContain('claude-haiku-4-5')
      expect(modelIds).toContain('claude-opus-4-5')
    })

    test('should include model name for each model', () => {
      const models = ProviderRegistry.getModels('gemini')

      models.forEach(model => {
        expect(model).toHaveProperty('id')
        expect(model).toHaveProperty('name')
        expect(typeof model.id).toBe('string')
        expect(typeof model.name).toBe('string')
      })
    })

    test('should include model options when defined', () => {
      const models = ProviderRegistry.getModels('openai')

      const o1Model = models.find(m => m.id === 'o1')
      expect(o1Model).toBeDefined()
      expect(o1Model.options).toBeDefined()
      expect(o1Model.options.reasoningEffort).toBe('high')
    })

    test('should return empty array for non-existent provider', () => {
      const models = ProviderRegistry.getModels('non-existent')
      expect(Array.isArray(models)).toBe(true)
      expect(models.length).toBe(0)
    })

    test('should return empty array for provider without models', () => {
      const models = ProviderRegistry.getModels('lm-studio')
      expect(Array.isArray(models)).toBe(true)
      // LM Studio starts with no models since they're user-defined
    })
  })

  describe('Provider Types', () => {
    test('should categorize providers by type', () => {
      const gemini = ProviderRegistry.getProvider('gemini')
      const openai = ProviderRegistry.getProvider('openai')
      const anthropic = ProviderRegistry.getProvider('anthropic')
      const grok = ProviderRegistry.getProvider('grok')
      const ollama = ProviderRegistry.getProvider('ollama')

      expect(gemini.type).toBe('gemini')
      expect(openai.type).toBe('openai')
      expect(anthropic.type).toBe('anthropic')
      expect(grok.type).toBe('openai-compatible')
      expect(ollama.type).toBe('openai-compatible')
    })

    test('should have baseUrl for openai-compatible providers', () => {
      const allProviders = ProviderRegistry.getAllProviders()

      Object.values(allProviders).forEach(provider => {
        if (provider.type === 'openai-compatible') {
          expect(provider.baseUrl).toBeDefined()
          expect(typeof provider.baseUrl).toBe('string')
        }
      })
    })

    test('should not have baseUrl for SDK-based providers', () => {
      const gemini = ProviderRegistry.getProvider('gemini')
      const openai = ProviderRegistry.getProvider('openai')
      const anthropic = ProviderRegistry.getProvider('anthropic')

      expect(gemini.baseUrl).toBeUndefined()
      expect(openai.baseUrl).toBeUndefined()
      expect(anthropic.baseUrl).toBeUndefined()
    })
  })

  describe('Default Providers Config Generation', () => {
    test('should generate default providers config', () => {
      const config = ProviderRegistry.generateDefaultProvidersConfig()

      expect(config).toBeDefined()
      expect(typeof config).toBe('object')
    })

    test('should include all providers in default config', () => {
      const config = ProviderRegistry.generateDefaultProvidersConfig()

      expect(config.gemini).toBeDefined()
      expect(config.openai).toBeDefined()
      expect(config.anthropic).toBeDefined()
      expect(config.grok).toBeDefined()
      expect(config.openrouter).toBeDefined()
      expect(config.ollama).toBeDefined()
      expect(config['lm-studio']).toBeDefined()
    })

    test('should set empty API keys by default', () => {
      const config = ProviderRegistry.generateDefaultProvidersConfig()

      Object.values(config).forEach(providerConfig => {
        expect(providerConfig.apiKey).toBe('')
      })
    })

    test('should set default models', () => {
      const config = ProviderRegistry.generateDefaultProvidersConfig()

      expect(config.gemini.model).toBe('gemini-2.0-flash-exp')
      expect(config.openai.model).toBe('gpt-4o')
      expect(config.anthropic.model).toBe('claude-sonnet-4-5')
    })

    test('should include baseUrl for openai-compatible providers', () => {
      const config = ProviderRegistry.generateDefaultProvidersConfig()

      expect(config.grok.baseUrl).toBe('https://api.x.ai/v1')
      expect(config.openrouter.baseUrl).toBe('https://openrouter.ai/api/v1')
      expect(config.ollama.baseUrl).toBe('http://localhost:11434/v1')
      expect(config['lm-studio'].baseUrl).toBe('http://localhost:1234/v1')
    })

    test('should not include baseUrl for SDK-based providers', () => {
      const config = ProviderRegistry.generateDefaultProvidersConfig()

      expect(config.gemini.baseUrl).toBeUndefined()
      expect(config.openai.baseUrl).toBeUndefined()
      expect(config.anthropic.baseUrl).toBeUndefined()
    })
  })

  describe('Provider Metadata Structure', () => {
    test('should have required fields for each provider', () => {
      const allProviders = ProviderRegistry.getAllProviders()

      Object.entries(allProviders).forEach(([id, provider]) => {
        expect(provider).toHaveProperty('name')
        expect(provider).toHaveProperty('type')
        expect(provider).toHaveProperty('description')
        expect(provider).toHaveProperty('website')
        expect(provider).toHaveProperty('defaultModel')
        expect(provider).toHaveProperty('models')

        expect(typeof provider.name).toBe('string')
        expect(typeof provider.type).toBe('string')
        expect(typeof provider.description).toBe('string')
        expect(typeof provider.website).toBe('string')
        expect(typeof provider.models).toBe('object')
      })
    })

    test('should have valid website URLs', () => {
      const allProviders = ProviderRegistry.getAllProviders()

      Object.values(allProviders).forEach(provider => {
        expect(provider.website).toMatch(/^https?:\/\//)
      })
    })

    test('should have lastFetched field for model caching', () => {
      const gemini = ProviderRegistry.getProvider('gemini')

      expect(gemini).toHaveProperty('lastFetched')
      // Initially null since models haven't been fetched
    })
  })

  describe('Model Updates', () => {
    test('should update provider models', () => {
      const newModels = {
        'test-model-1': { name: 'Test Model 1' },
        'test-model-2': { name: 'Test Model 2' }
      }

      ProviderRegistry.updateProviderModels('gemini', newModels)

      const gemini = ProviderRegistry.getProvider('gemini')
      const modelIds = Object.keys(gemini.models)

      expect(modelIds).toContain('test-model-1')
      expect(modelIds).toContain('test-model-2')
    })

    test('should update lastFetched timestamp', () => {
      const beforeTime = new Date().toISOString()

      ProviderRegistry.updateProviderModels('gemini', {
        'test-model': { name: 'Test' }
      })

      const gemini = ProviderRegistry.getProvider('gemini')
      expect(gemini.lastFetched).toBeDefined()
      expect(new Date(gemini.lastFetched).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeTime).getTime()
      )
    })
  })
})
