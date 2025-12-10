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
    testDir = path.join('/tmp/ghostpad-test')
    configPath = path.join(testDir, 'ghostpad-config.json')

    // Ensure test directory exists
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }

    // Clean up any existing config file
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
    }

    // Create fresh instance with test directory
    configService = new ConfigService(testDir)
  })

  afterEach(() => {
    // Clean up
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
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
    })

    test('should have default model configurations', () => {
      const geminiConfig = configService.getProviderConfig('gemini')
      expect(geminiConfig.model).toBe('gemini-2.5-flash')
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
      expect(config.model).toBe('gemini-2.5-flash')
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

  describe('Model Migration', () => {
    test('should migrate old Gemini 1.5 models to 2.5', () => {
      // Manually create config with old model
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
      const config = migratedService.getProviderConfig('gemini')

      expect(config.model).toBe('gemini-2.5-flash')
    })

    test('should not migrate Gemini 2.x models', () => {
      const newConfig = {
        llmProvider: 'gemini',
        geminiApiKey: 'test-key',
        geminiConfig: {
          model: 'gemini-2.0-flash'
        }
      }

      fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2))

      const service = new ConfigService(testDir)
      const config = service.getProviderConfig('gemini')

      expect(config.model).toBe('gemini-2.0-flash')
    })
  })

  describe('Persistence', () => {
    test('should persist API keys to disk', () => {
      configService.setApiKey('gemini', 'persistent-key')

      // Verify file exists
      expect(fs.existsSync(configPath)).toBe(true)

      // Read file and verify content
      const fileContent = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      expect(fileContent.geminiApiKey).toBe('persistent-key')
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
      expect(allConfig.llmProvider).toBe('gemini')
      expect(allConfig.geminiApiKey).toBe('test-key')
    })

    test('should clear all configuration', () => {
      configService.setApiKey('gemini', 'test-key')
      configService.setActiveProvider('openai')

      configService.clearAll()

      expect(configService.getActiveProvider()).toBe('gemini')
      expect(configService.getApiKey('gemini')).toBe('')
    })
  })
})
