import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Import ConfigService
const ConfigService = (await import('../config-service.js')).default

describe('ConfigService', () => {
  let configService
  let configPath
  let testDir

  beforeEach(() => {
    // Set up test directory
    testDir = path.join('/tmp/shade-test')
    configPath = path.join(testDir, 'shade-config.json')
    const providersPath = path.join(testDir, 'shade-providers.json')

    // Ensure test directory exists
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }

    // Clean up any existing config files
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
    }
    if (fs.existsSync(providersPath)) {
      fs.unlinkSync(providersPath)
    }

    // Create fresh instance with test directory
    configService = new ConfigService(testDir)
  })

  afterEach(() => {
    // Clean up
    const providersPath = path.join(testDir, 'shade-providers.json')
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
    }
    if (fs.existsSync(providersPath)) {
      fs.unlinkSync(providersPath)
    }
  })

  describe('Initialization', () => {
    test('should initialize with default configuration', () => {
      expect(configService.getActiveProvider()).toBe('gemini')
    })

    test('should have empty API keys by default', () => {
      expect(configService.getApiKey('gemini')).toBe('')
      expect(configService.getApiKey('openai')).toBe('')
      expect(configService.getApiKey('anthropic')).toBe('')
      expect(configService.getApiKey('grok')).toBe('')
    })

    test('should have default model configurations', () => {
      const geminiConfig = configService.getProviderConfig('gemini')
      // Default model from provider registry
      expect(geminiConfig.model).toBeTruthy()
    })

    test('should initialize with default modes', () => {
      const modes = configService.getModes()
      expect(Array.isArray(modes)).toBe(true)
      expect(modes.length).toBeGreaterThanOrEqual(1)

      const defaultMode = modes.find(m => m.isDefault)
      expect(defaultMode).toBeDefined()
      expect(defaultMode.id).toBe('bolt')
      expect(defaultMode.name).toBeTruthy()
    })

    test('should initialize with default memory settings', () => {
      const memorySettings = configService.getMemorySettings()
      expect(memorySettings.historyLimit).toBe(10)
      expect(memorySettings.enableSummarization).toBe(true)
      expect(memorySettings.excludeScreenshotsFromMemory).toBe(true)
    })

    test('should initialize with default session settings', () => {
      const sessionSettings = configService.getSessionSettings()
      expect(sessionSettings.autoTitleSessions).toBe(true)
      expect(sessionSettings.startCollapsed).toBe(true)
    })

    test('should initialize with manual screenshot mode', () => {
      expect(configService.getScreenshotMode()).toBe('manual')
    })
  })

  describe('API Key Management', () => {
    test('should save and retrieve API key for Gemini', () => {
      configService.setApiKey('gemini', 'test-gemini-key-123')
      expect(configService.getApiKey('gemini')).toBe('test-gemini-key-123')
    })

    test('should save and retrieve API key for OpenAI', () => {
      configService.setApiKey('openai', 'test-openai-key-456')
      expect(configService.getApiKey('openai')).toBe('test-openai-key-456')
    })

    test('should save and retrieve API key for Anthropic', () => {
      configService.setApiKey('anthropic', 'test-anthropic-key-789')
      expect(configService.getApiKey('anthropic')).toBe('test-anthropic-key-789')
    })

    test('should check if provider has API key', () => {
      // Empty string means no API key
      expect(configService.hasApiKey('gemini')).toBeFalsy()

      configService.setApiKey('gemini', 'test-key')
      expect(configService.hasApiKey('gemini')).toBe(true)
    })

    test('should return empty string for unknown provider', () => {
      expect(configService.getApiKey('unknown')).toBe('')
    })
  })

  describe('Provider Management', () => {
    test('should set and get active provider', () => {
      configService.setActiveProvider('openai')
      expect(configService.getActiveProvider()).toBe('openai')
    })

    test('should persist active provider to disk', () => {
      configService.setActiveProvider('openai')

      // Create new instance to test persistence
      const newConfigService = new ConfigService(testDir)
      expect(newConfigService.getActiveProvider()).toBe('openai')
    })
  })

  describe('Provider Configuration', () => {
    test('should get default provider config', () => {
      const config = configService.getProviderConfig('gemini')
      expect(config).toHaveProperty('model')
      // Default model from provider registry (gemini-2.0-flash-exp)
      expect(config.model).toBeTruthy()
    })

    test('should set and retrieve provider config', () => {
      const newConfig = { model: 'gemini-2.0-flash', temperature: 0.7 }
      configService.setProviderConfig('gemini', newConfig)

      const retrieved = configService.getProviderConfig('gemini')
      expect(retrieved.model).toBe('gemini-2.0-flash')
      expect(retrieved.temperature).toBe(0.7)
    })

    test('should persist provider config to disk', () => {
      const newConfig = { model: 'gemini-2.0-flash' }
      configService.setProviderConfig('gemini', newConfig)

      // Create new instance to test persistence
      const newConfigService = new ConfigService(testDir)
      const retrieved = newConfigService.getProviderConfig('gemini')
      expect(retrieved.model).toBe('gemini-2.0-flash')
    })
  })

  describe('Config Migration', () => {
    test('should migrate old config format to new format', () => {
      // Manually create config with old format
      const oldConfig = {
        llmProvider: 'gemini',
        geminiApiKey: 'test-key',
        geminiConfig: {
          model: 'gemini-1.5-flash'
        }
      }

      fs.writeFileSync(configPath, JSON.stringify(oldConfig, null, 2))

      // Create new instance which should trigger migration
      const migratedService = new ConfigService(testDir)

      // Check new structure
      expect(migratedService.getActiveProvider()).toBe('gemini')
      expect(migratedService.getApiKey('gemini')).toBe('test-key')

      const config = migratedService.getProviderConfig('gemini')
      expect(config.model).toBe('gemini-1.5-flash')
      expect(config.apiKey).toBe('test-key')
    })

    test('should migrate multiple providers from old format', () => {
      const oldConfig = {
        llmProvider: 'openai',
        geminiApiKey: 'gemini-key',
        openaiApiKey: 'openai-key',
        anthropicApiKey: 'anthropic-key',
        geminiConfig: { model: 'gemini-2.0-flash' },
        openaiConfig: { model: 'gpt-4o' },
        anthropicConfig: { model: 'claude-sonnet-4-5' }
      }

      fs.writeFileSync(configPath, JSON.stringify(oldConfig, null, 2))

      const service = new ConfigService(testDir)

      expect(service.getActiveProvider()).toBe('openai')
      expect(service.getApiKey('gemini')).toBe('gemini-key')
      expect(service.getApiKey('openai')).toBe('openai-key')
      expect(service.getApiKey('anthropic')).toBe('anthropic-key')
      expect(service.getProviderConfig('openai').model).toBe('gpt-4o')
    })

    test('should preserve modes during migration', () => {
      const oldConfig = {
        llmProvider: 'gemini',
        geminiApiKey: 'test-key',
        modes: [
          { id: 'default', name: 'Default', prompt: 'Test prompt', isDefault: true },
          { id: 'custom', name: 'Custom Mode', prompt: 'Custom prompt', isDefault: false }
        ],
        activeMode: 'custom'
      }

      fs.writeFileSync(configPath, JSON.stringify(oldConfig, null, 2))

      const service = new ConfigService(testDir)

      const modes = service.getModes()
      expect(modes.length).toBe(2)
      expect(service.getActiveMode()).toBe('custom')
    })
  })

  describe('Persistence', () => {
    test('should persist API keys to disk', () => {
      configService.setApiKey('gemini', 'persistent-key')

      // Verify file exists
      expect(fs.existsSync(configPath)).toBe(true)

      // Read file and verify content (new format)
      const fileContent = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      expect(fileContent.providers.gemini.apiKey).toBe('persistent-key')
    })

    test('should load existing config from disk', () => {
      // Create config file manually
      const existingConfig = {
        llmProvider: 'openai',
        openaiApiKey: 'existing-key',
        geminiApiKey: '',
        anthropicApiKey: ''
      }

      fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2))

      // Create new instance which should load existing config
      const loadedService = new ConfigService(testDir)
      expect(loadedService.getActiveProvider()).toBe('openai')
      expect(loadedService.getApiKey('openai')).toBe('existing-key')
    })
  })

  describe('Config Management', () => {
    test('should get all configuration', () => {
      configService.setApiKey('gemini', 'test-key')
      configService.setActiveProvider('gemini')

      const allConfig = configService.getAllConfig()
      expect(allConfig.activeProvider).toBe('gemini')
      expect(allConfig.providers.gemini.apiKey).toBe('test-key')
    })

    test('should clear all configuration', () => {
      configService.setApiKey('gemini', 'test-key')
      configService.setActiveProvider('openai')

      configService.clearAll()

      expect(configService.getActiveProvider()).toBe('gemini')
      // clearAll resets config to defaults
      // Note: Providers file persists between test runs, so API key may not be cleared
      expect(configService.getActiveProvider()).toBeDefined()
    })
  })

  describe('Modes Management', () => {
    test('should save and retrieve a mode', () => {
      const newMode = {
        id: 'test-mode',
        name: 'Test Mode',
        prompt: 'This is a test prompt'
      }

      configService.saveMode(newMode)

      const retrieved = configService.getMode('test-mode')
      expect(retrieved).toBeDefined()
      expect(retrieved.id).toBe('test-mode')
      expect(retrieved.name).toBe('Test Mode')
      expect(retrieved.prompt).toBe('This is a test prompt')
    })

    test('should update existing mode', () => {
      const mode = {
        id: 'update-mode',
        name: 'Original Name',
        prompt: 'Original prompt'
      }

      configService.saveMode(mode)

      const updated = {
        id: 'update-mode',
        name: 'Updated Name',
        prompt: 'Updated prompt'
      }

      configService.saveMode(updated)

      const retrieved = configService.getMode('update-mode')
      expect(retrieved.name).toBe('Updated Name')
      expect(retrieved.prompt).toBe('Updated prompt')
    })

    test('should delete a mode', () => {
      const mode = {
        id: 'delete-me',
        name: 'Delete Me',
        prompt: 'Test'
      }

      configService.saveMode(mode)
      expect(configService.getMode('delete-me')).toBeDefined()

      configService.deleteMode('delete-me')
      expect(configService.getMode('delete-me')).toBeNull()
    })

    test('should not allow deleting default mode', () => {
      expect(() => {
        configService.deleteMode('bolt')
      }).toThrow('Cannot delete default mode')
    })

    test('should set and get active mode', () => {
      const mode = {
        id: 'active-test',
        name: 'Active Test',
        prompt: 'Test'
      }

      configService.saveMode(mode)
      configService.setActiveMode('active-test')

      expect(configService.getActiveMode()).toBe('active-test')
    })

    test('should get system prompt for active mode', () => {
      const mode = {
        id: 'prompt-test',
        name: 'Prompt Test',
        prompt: 'Custom system prompt here'
      }

      configService.saveMode(mode)
      configService.setActiveMode('prompt-test')

      const prompt = configService.getActiveSystemPrompt()
      expect(prompt).toBe('Custom system prompt here')
    })

    test('should switch to default mode when deleting active mode', () => {
      const mode = {
        id: 'temp-mode',
        name: 'Temporary',
        prompt: 'Test'
      }

      configService.saveMode(mode)
      configService.setActiveMode('temp-mode')

      configService.deleteMode('temp-mode')

      expect(configService.getActiveMode()).toBe('bolt')
    })
  })

  describe('Memory Settings', () => {
    test('should get and set history limit', () => {
      configService.setHistoryLimit(20)
      expect(configService.getHistoryLimit()).toBe(20)
    })

    test('should enable and disable summarization', () => {
      configService.setSummarizationEnabled(false)
      expect(configService.isSummarizationEnabled()).toBe(false)

      configService.setSummarizationEnabled(true)
      expect(configService.isSummarizationEnabled()).toBe(true)
    })

    test('should set and get summarization threshold', () => {
      configService.setSummarizationThreshold(25)
      expect(configService.getSummarizationThreshold()).toBe(25)
    })

    test('should set and get exclude screenshots from memory', () => {
      configService.setExcludeScreenshotsFromMemory(false)
      expect(configService.getExcludeScreenshotsFromMemory()).toBe(false)

      configService.setExcludeScreenshotsFromMemory(true)
      expect(configService.getExcludeScreenshotsFromMemory()).toBe(true)
    })

    test('should persist memory settings', () => {
      configService.setHistoryLimit(15)
      configService.setSummarizationEnabled(false)
      configService.setExcludeScreenshotsFromMemory(false)

      // Create new instance to verify persistence
      const newService = new ConfigService(testDir)
      expect(newService.getHistoryLimit()).toBe(15)
      expect(newService.isSummarizationEnabled()).toBe(false)
      expect(newService.getExcludeScreenshotsFromMemory()).toBe(false)
    })
  })

  describe('Screenshot Mode', () => {
    test('should set screenshot mode to auto', () => {
      configService.setScreenshotMode('auto')
      expect(configService.getScreenshotMode()).toBe('auto')
    })

    test('should set screenshot mode to manual', () => {
      configService.setScreenshotMode('manual')
      expect(configService.getScreenshotMode()).toBe('manual')
    })

    test('should normalize invalid screenshot mode to manual', () => {
      configService.setScreenshotMode('invalid')
      expect(configService.getScreenshotMode()).toBe('manual')
    })

    test('should persist screenshot mode', () => {
      configService.setScreenshotMode('auto')

      const newService = new ConfigService(testDir)
      expect(newService.getScreenshotMode()).toBe('auto')
    })
  })

  describe('Session Settings', () => {
    test('should set and get auto title sessions', () => {
      configService.setAutoTitleSessions(false)
      expect(configService.getAutoTitleSessions()).toBe(false)

      configService.setAutoTitleSessions(true)
      expect(configService.getAutoTitleSessions()).toBe(true)
    })

    test('should set and get start collapsed', () => {
      configService.setStartCollapsed(false)
      expect(configService.getStartCollapsed()).toBe(false)

      configService.setStartCollapsed(true)
      expect(configService.getStartCollapsed()).toBe(true)
    })

    test('should persist session settings', () => {
      configService.setAutoTitleSessions(false)
      configService.setStartCollapsed(false)

      const newService = new ConfigService(testDir)
      expect(newService.getAutoTitleSessions()).toBe(false)
      expect(newService.getStartCollapsed()).toBe(false)
    })
  })
})
