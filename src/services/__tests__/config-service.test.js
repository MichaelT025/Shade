import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => false),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  encryptString: vi.fn(value => Buffer.from(`encrypted:${value}`)),
  decryptString: vi.fn(buffer => {
    const value = Buffer.from(buffer).toString()
    if (!value.startsWith('encrypted:')) throw new Error('Not encrypted')
    return value.slice('encrypted:'.length)
  })
}))

// Import ConfigService
const ConfigService = (await import('../config-service.js')).default

describe('ConfigService', () => {
  let configService
  let configPath
  let testDir

  beforeEach(() => {
    // Unit tests supply a keyring on every host; no real Electron keyring runs
    // under Node. Unavailable/locked backends are exercised explicitly below.
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
    safeStorageMock.encryptString.mockImplementation(value => Buffer.from(`encrypted:${value}`))
    safeStorageMock.decryptString.mockImplementation(buffer => {
      const value = Buffer.from(buffer).toString()
      if (!value.startsWith('encrypted:')) throw new Error('Not encrypted')
      return value.slice('encrypted:'.length)
    })

    // Set up test directory
    testDir = path.join('/tmp/shade-test')
    configPath = path.join(testDir, 'data', 'config.json')
    const providersPath = path.join(testDir, 'data', 'providers.json')

    // Ensure test directory exists
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }

    // Clean up any existing config files in data dir
    const dataDir = path.join(testDir, 'data')
    if (fs.existsSync(dataDir)) {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath)
      }
      if (fs.existsSync(providersPath)) {
        fs.unlinkSync(providersPath)
      }
    }

    // Create fresh instance with test directory
    configService = new ConfigService(testDir, { secureStorage: safeStorageMock })
  })

  afterEach(() => {
    // Clean up
    const providersPath = path.join(testDir, 'data', 'providers.json')
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

    test('should preserve escaped LaTeX delimiters in fallback system prompt', () => {
      configService.config.activeMode = 'missing-mode'
      const prompt = configService.getActiveSystemPrompt()

      expect(prompt).toContain('\\(x^2\\)')
      expect(prompt).toContain('\\[\\int_0^1 x^2\\,dx\\]')
    })
  })

  describe('Default config isolation', () => {
    test('saveMode does not corrupt defaultConfig.modes (factory default isolation)', () => {
      const service = new ConfigService(testDir, { secureStorage: safeStorageMock })
      service.getModes()
      const factory = service.getDefaultModes().find(m => m.id === 'bolt').prompt

      service.saveMode({ id: 'bolt', name: 'Bolt', prompt: 'HACKED-PROMPT' })

      expect(service.getDefaultModes().find(m => m.id === 'bolt').prompt).toBe(factory)
      expect(service.getDefaultModes().find(m => m.id === 'bolt').prompt).not.toBe('HACKED-PROMPT')
    })

    test('setHistoryLimit does not corrupt defaultConfig.memorySettings', () => {
      const service = new ConfigService(testDir, { secureStorage: safeStorageMock })
      const f = service.defaultConfig.memorySettings.historyLimit

      service.setHistoryLimit(f + 500)

      expect(service.defaultConfig.memorySettings.historyLimit).toBe(f)
    })

    test('setAutoUpdateEnabled does not corrupt defaultConfig when config loaded from disk', () => {
      const partialConfig = { activeProvider: 'gemini', providers: {} }
      fs.writeFileSync(configPath, JSON.stringify(partialConfig))
      const service = new ConfigService(testDir, { secureStorage: safeStorageMock })
      const before = service.defaultConfig.autoUpdate.enabled

      service.setAutoUpdateEnabled(!before)

      expect(service.defaultConfig.autoUpdate.enabled).toBe(before)
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

    test('should return empty string for unknown provider', () => {
      expect(configService.getApiKey('unknown')).toBe('')
    })
  })

  describe('Linux secure API key storage', () => {
    const originalPlatform = process.platform

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
      safeStorageMock.getSelectedStorageBackend.mockReturnValue('gnome_libsecret')
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    test('stores new keys with an encrypted-value marker when a keyring is available', () => {
      configService.setApiKey('gemini', 'linux-key')

      const stored = configService.getAllConfig().providers.gemini.apiKey
      expect(stored).toBe(`enc:v1:${Buffer.from('encrypted:linux-key').toString('base64')}`)
      expect(configService.getApiKey('gemini')).toBe('linux-key')
    })

    test('refuses to save a key when Electron selects the basic_text backend', () => {
      safeStorageMock.getSelectedStorageBackend.mockReturnValue('basic_text')

      expect(() => configService.setApiKey('gemini', 'must-not-be-plaintext')).toThrow(/Secure storage is unavailable/)
      expect(configService.getAllConfig().providers.gemini.apiKey).toBe('')
      expect(fs.existsSync(configPath)).toBe(false)
    })

    test('refuses to save a key when Electron cannot identify a secure backend', () => {
      safeStorageMock.getSelectedStorageBackend.mockReturnValue('unknown')

      expect(() => configService.setApiKey('gemini', 'must-not-be-plaintext')).toThrow(/Secure storage is unavailable/)
      expect(configService.getAllConfig().providers.gemini.apiKey).toBe('')
    })

    test('refuses to save a key while the keyring is locked or unavailable', () => {
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)

      expect(() => configService.setApiKey('gemini', 'must-not-be-plaintext')).toThrow(/Unlock or install a Secret Service-compatible keyring/)
      expect(configService.getAllConfig().providers.gemini.apiKey).toBe('')
    })

    test('preserves an existing marked value while the keyring is unavailable', () => {
      const markedKey = `enc:v1:${Buffer.from('encrypted:existing-key').toString('base64')}`
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify({
        activeProvider: 'gemini',
        providers: { gemini: { apiKey: markedKey } }
      }))
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)

      const service = new ConfigService(testDir, { secureStorage: safeStorageMock })

      expect(service.getAllConfig().providers.gemini.apiKey).toBe(markedKey)
      expect(() => service.getApiKey('gemini')).toThrow(/Secure storage is unavailable/)
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).providers.gemini.apiKey).toBe(markedKey)
    })

    test('keeps a marked value intact when it cannot be decrypted', () => {
      const markedKey = `enc:v1:${Buffer.from('encrypted:existing-key').toString('base64')}`
      safeStorageMock.decryptString.mockImplementation(() => {
        throw new Error('keyring reset')
      })
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify({
        activeProvider: 'gemini',
        providers: { gemini: { apiKey: markedKey } }
      }))

      const service = new ConfigService(testDir, { secureStorage: safeStorageMock })

      expect(() => service.getApiKey('gemini')).toThrow(/cannot be decrypted on this machine/)
      expect(service.getAllConfig().providers.gemini.apiKey).toBe(markedKey)
    })

    test('does not return an unmarked legacy ciphertext as an API key when the keyring is unavailable', () => {
      const legacyCiphertext = Buffer.from('encrypted:old-machine-key').toString('base64')
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify({
        activeProvider: 'gemini',
        providers: { gemini: { apiKey: legacyCiphertext } }
      }))
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)

      const service = new ConfigService(testDir, { secureStorage: safeStorageMock })

      expect(() => service.getApiKey('gemini')).toThrow(/Secure storage is unavailable/)
      expect(service.getAllConfig().providers.gemini.apiKey).toBe(legacyCiphertext)
    })

    test('migrates a legacy encrypted value to the explicit marker', () => {
      const legacyCiphertext = Buffer.from('encrypted:legacy-key').toString('base64')
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify({
        activeProvider: 'gemini',
        providers: { gemini: { apiKey: legacyCiphertext } }
      }))

      const service = new ConfigService(testDir, { secureStorage: safeStorageMock })

      expect(service.getAllConfig().providers.gemini.apiKey).toBe(`enc:v1:${legacyCiphertext}`)
      expect(service.getApiKey('gemini')).toBe('legacy-key')
    })

    test('never re-encrypts unreadable ciphertext from another machine', () => {
      const ciphertext = Buffer.from('other-machine-ciphertext').toString('base64')
      fs.mkdirSync(path.dirname(configPath), { recursive: true })
      fs.writeFileSync(configPath, JSON.stringify({ providers: { gemini: { apiKey: ciphertext } } }))
      safeStorageMock.encryptString.mockClear()
      const service = new ConfigService(testDir, { secureStorage: safeStorageMock })
      expect(() => service.getApiKey('gemini')).toThrow(/legacy API key cannot be decrypted/)
      expect(safeStorageMock.encryptString).not.toHaveBeenCalled()
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).providers.gemini.apiKey).toBe(ciphertext)
    })

    test('failed encryption preserves the saved key and allows deletion while locked', () => {
      configService.setApiKey('gemini', 'existing-key')
      const stored = fs.readFileSync(configPath, 'utf8')
      safeStorageMock.encryptString.mockImplementation(() => { throw new Error('Keyring locked') })
      expect(() => configService.setApiKey('gemini', 'replacement')).toThrow(/Secure storage/)
      expect(fs.readFileSync(configPath, 'utf8')).toBe(stored)
      expect(configService.getApiKey('gemini')).toBe('existing-key')
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
      configService.setApiKey('gemini', '')
      expect(configService.getApiKey('gemini')).toBe('')
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).providers.gemini.apiKey).toBe('')
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
      const newConfigService = new ConfigService(testDir, { secureStorage: safeStorageMock })
      expect(newConfigService.getActiveProvider()).toBe('openai')
    })
  })

  describe('Provider Configuration', () => {
    test('should get default provider config', () => {
      const config = configService.getProviderConfig('gemini')
      expect(config).toHaveProperty('model')
      // Default model from provider registry
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
      const newConfigService = new ConfigService(testDir, { secureStorage: safeStorageMock })
      const retrieved = newConfigService.getProviderConfig('gemini')
      expect(retrieved.model).toBe('gemini-2.0-flash')
    })

    test('does not allow provider configuration updates to overwrite an API key', () => {
      configService.setApiKey('gemini', 'stored-key')

      configService.setProviderConfig('gemini', {
        model: 'gemini-2.0-flash',
        apiKey: 'plaintext-injection'
      })

      expect(configService.getApiKey('gemini')).toBe('stored-key')
      expect(configService.getProviderConfig('gemini').apiKey).toMatch(/^enc:v1:/)
      expect(configService.getApiKey('gemini')).toBe('stored-key')
      expect(configService.getProviderConfig('gemini').model).toBe('gemini-2.0-flash')
    })
  })

  describe('Config Migration', () => {
    test('should migrate old config format to new format', () => {
      // Manually create config with old format in the ROOT (where migration logic expects it)
      const oldConfigPath = path.join(testDir, 'shade-config.json')
      const oldConfig = {
        llmProvider: 'gemini',
        geminiApiKey: 'test-key',
        geminiConfig: {
          model: 'gemini-1.5-flash'
        }
      }

      fs.writeFileSync(oldConfigPath, JSON.stringify(oldConfig, null, 2))

      // Create new instance which should trigger migration
      const migratedService = new ConfigService(testDir, { secureStorage: safeStorageMock })

      // Check new structure
      expect(migratedService.getActiveProvider()).toBe('gemini')
      expect(migratedService.getApiKey('gemini')).toBe('test-key')

      const config = migratedService.getProviderConfig('gemini')
      expect(config.model).toBe('gemini-1.5-flash')
    })

    test('should migrate multiple providers from old format', () => {
      const oldConfigPath = path.join(testDir, 'shade-config.json')
      const oldConfig = {
        llmProvider: 'openai',
        geminiApiKey: 'gemini-key',
        openaiApiKey: 'openai-key',
        anthropicApiKey: 'anthropic-key',
        geminiConfig: { model: 'gemini-2.0-flash' },
        openaiConfig: { model: 'gpt-4o' },
        anthropicConfig: { model: 'claude-sonnet-4-5' }
      }

      fs.writeFileSync(oldConfigPath, JSON.stringify(oldConfig, null, 2))

      const service = new ConfigService(testDir, { secureStorage: safeStorageMock })

      expect(service.getActiveProvider()).toBe('openai')
      expect(service.getApiKey('gemini')).toBe('gemini-key')
      expect(service.getApiKey('openai')).toBe('openai-key')
      expect(service.getApiKey('anthropic')).toBe('anthropic-key')
      expect(service.getProviderConfig('openai').model).toBe('gpt-4o')
    })

    test('should preserve modes during migration', () => {
      const oldConfigPath = path.join(testDir, 'shade-config.json')
      const oldConfig = {
        llmProvider: 'gemini',
        geminiApiKey: 'test-key',
        modes: [
          { id: 'default', name: 'Default', prompt: 'Test prompt', isDefault: true },
          { id: 'custom', name: 'Custom Mode', prompt: 'Custom prompt', isDefault: false }
        ],
        activeMode: 'custom'
      }

      fs.writeFileSync(oldConfigPath, JSON.stringify(oldConfig, null, 2))

      const service = new ConfigService(testDir, { secureStorage: safeStorageMock })

      const modes = service.getModes()
      // We expect 2 modes because we manually set them in the old config
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
      expect(fileContent.providers.gemini.apiKey).toMatch(/^enc:v1:/)
      expect(configService.getApiKey('gemini')).toBe('persistent-key')
    })

    test('should load existing config from disk', () => {
      // Create config file manually in the NEW location
      const existingConfig = {
        activeProvider: 'openai',
        providers: {
          openai: {
            apiKey: 'existing-key',
            model: 'gpt-4o'
          }
        }
      }

      fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2))

      // Create new instance which should load existing config
      const loadedService = new ConfigService(testDir, { secureStorage: safeStorageMock })
      expect(loadedService.getActiveProvider()).toBe('openai')
      expect(loadedService.getApiKey('openai')).toBe('existing-key')
    })

    test('should fall back to defaults when config file is malformed', () => {
      fs.writeFileSync(configPath, '{invalid-json', 'utf8')

      const loadedService = new ConfigService(testDir, { secureStorage: safeStorageMock })
      expect(loadedService.getActiveProvider()).toBe('gemini')
      expect(loadedService.getApiKey('openai')).toBe('')
    })
  })

  describe('Config Management', () => {
    test('should get all configuration', () => {
      configService.setApiKey('gemini', 'test-key')
      configService.setActiveProvider('gemini')

      const allConfig = configService.getAllConfig()
      expect(allConfig.activeProvider).toBe('gemini')
      expect(allConfig.providers.gemini.apiKey).toMatch(/^enc:v1:/)
      expect(configService.getApiKey('gemini')).toBe('test-key')
    })

    test('should clear all configuration', () => {
      configService.setApiKey('gemini', 'test-key')
      configService.setActiveProvider('openai')

      configService.clearAll()

      expect(configService.getActiveProvider()).toBe('gemini')
      // clearAll resets config to defaults
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

    test('should set and get exclude screenshots from memory', () => {
      configService.setExcludeScreenshotsFromMemory(false)
      expect(configService.getExcludeScreenshotsFromMemory()).toBe(false)

      configService.setExcludeScreenshotsFromMemory(true)
      expect(configService.getExcludeScreenshotsFromMemory()).toBe(true)
    })

    test('should persist memory settings', () => {
      configService.setHistoryLimit(15)
      configService.setExcludeScreenshotsFromMemory(false)

      // Create new instance to verify persistence
      const newService = new ConfigService(testDir, { secureStorage: safeStorageMock })
      expect(newService.getHistoryLimit()).toBe(15)
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

      const newService = new ConfigService(testDir, { secureStorage: safeStorageMock })
      expect(newService.getScreenshotMode()).toBe('auto')
    })
  })

  describe('Session Settings', () => {
    test('should set auto title sessions', () => {
      configService.setAutoTitleSessions(false)
      expect(configService.getSessionSettings().autoTitleSessions).toBe(false)

      configService.setAutoTitleSessions(true)
      expect(configService.getSessionSettings().autoTitleSessions).toBe(true)
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

      const newService = new ConfigService(testDir, { secureStorage: safeStorageMock })
      expect(newService.getSessionSettings().autoTitleSessions).toBe(false)
      expect(newService.getStartCollapsed()).toBe(false)
    })
  })
})
