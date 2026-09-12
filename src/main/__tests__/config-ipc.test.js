import { describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

function configIpcHarness({ mode, activeModeId = 'work', activeProvider = 'gemini' } = {}) {
  const handlers = new Map()
  const broadcastConfigChanged = vi.fn()
  const sendToWindows = vi.fn()

  const configService = {
    getActiveProvider: vi.fn(() => activeProvider),
    setActiveProvider: vi.fn(),
    getActiveMode: vi.fn(() => activeModeId),
    setActiveMode: vi.fn(),
    getMode: vi.fn(() => mode),
    saveMode: vi.fn(),
    getProviderConfig: vi.fn(() => ({ temperature: 0.7 })),
    setProviderConfig: vi.fn()
  }

  const factory = {
    getProviderMeta: vi.fn(() => ({
      strictCapabilities: true,
      models: { 'gpt-4o': { capabilities: { vision: true } } }
    }))
  }

  const context = {
    console: { error: vi.fn(), log: vi.fn(), warn: vi.fn() },
    module: { exports: {} },
    require: (id) => {
      if (id === 'node:crypto') return { randomUUID: () => 'test-uuid' }
      if (id === 'electron') return { ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, screen: {} }
      if (id.includes('llm-factory')) return factory
      throw new Error(`Unexpected dependency: ${id}`)
    }
  }

  const file = path.join(import.meta.dirname, '../ipc/config-ipc.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
  context.module.exports.registerConfigIpcHandlers({
    configService,
    updateService: null,
    sendToWindows,
    broadcastConfigChanged,
    getMainWindow: () => null
  })

  return { handlers, configService, broadcastConfigChanged, sendToWindows }
}

const overrideMode = {
  id: 'work',
  name: 'Work',
  prompt: 'Be brief',
  overrideProviderModel: true,
  provider: 'openai',
  model: 'gpt-4o'
}

describe('config IPC mode/provider separation (BUG-09)', () => {
  test('set-provider-config leaves an active override mode untouched for an unrelated provider', async () => {
    const { handlers, configService, broadcastConfigChanged } = configIpcHarness({ mode: overrideMode })

    const result = await handlers.get('set-provider-config')({}, {
      provider: 'grok',
      config: { model: 'grok-4' }
    })

    expect(result).toEqual({ success: true })
    expect(configService.setProviderConfig).toHaveBeenCalledWith('grok', { model: 'grok-4' })
    expect(configService.saveMode).not.toHaveBeenCalled()
    expect(broadcastConfigChanged).toHaveBeenCalled()
  })

  test('set-provider-config without a model leaves an active override mode untouched', async () => {
    const { handlers, configService } = configIpcHarness({ mode: overrideMode })

    await handlers.get('set-provider-config')({}, {
      provider: 'openai',
      config: { temperature: 0.2 }
    })

    expect(configService.setProviderConfig).toHaveBeenCalledWith('openai', { temperature: 0.2 })
    expect(configService.saveMode).not.toHaveBeenCalled()
  })

  test('set-provider-config for the overridden provider still leaves the mode untouched', async () => {
    const { handlers, configService } = configIpcHarness({ mode: overrideMode })

    await handlers.get('set-provider-config')({}, {
      provider: 'openai',
      config: { model: 'gpt-4o-mini' }
    })

    expect(configService.setProviderConfig).toHaveBeenCalledWith('openai', { model: 'gpt-4o-mini' })
    expect(configService.saveMode).not.toHaveBeenCalled()
  })

  test('save-mode still updates the mode and syncs provider config for the active override mode', async () => {
    const { handlers, configService, broadcastConfigChanged } = configIpcHarness({ mode: overrideMode })
    const edited = { ...overrideMode, model: 'gpt-4o-mini' }

    const result = await handlers.get('save-mode')({}, edited)

    expect(result).toEqual({ success: true })
    expect(configService.saveMode).toHaveBeenCalledWith(edited)
    expect(configService.setActiveProvider).toHaveBeenCalledWith('openai')
    expect(configService.setProviderConfig).toHaveBeenCalledWith('openai', {
      temperature: 0.7,
      model: 'gpt-4o-mini'
    })
    expect(broadcastConfigChanged).toHaveBeenCalled()
  })

  test('set-active-mode still applies the override provider/model to provider config', async () => {
    const { handlers, configService, sendToWindows, broadcastConfigChanged } = configIpcHarness({ mode: overrideMode })

    const result = await handlers.get('set-active-mode')({}, 'work')

    expect(result).toEqual({ success: true })
    expect(configService.setActiveMode).toHaveBeenCalledWith('work')
    expect(configService.setActiveProvider).toHaveBeenCalledWith('openai')
    expect(configService.setProviderConfig).toHaveBeenCalledWith('openai', {
      temperature: 0.7,
      model: 'gpt-4o'
    })
    expect(sendToWindows).toHaveBeenCalledWith('active-mode-changed', 'work')
    expect(broadcastConfigChanged).toHaveBeenCalled()
  })

  test('get-active-model-capabilities resolves the active mode override at request time', async () => {
    const { handlers } = configIpcHarness({ mode: overrideMode, activeProvider: 'gemini' })

    const capabilities = await handlers.get('get-active-model-capabilities')()

    expect(capabilities).toEqual({
      strict: true,
      vision: true,
      disabled: false,
      reason: undefined,
      model: 'gpt-4o'
    })
  })
})
