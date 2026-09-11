import { describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

function chatIpcHarness() {
  const handlers = new Map()
  const createProvider = vi.fn(() => ({
    streamResponse: vi.fn(async (_prompt, _image, _history, onChunk) => onChunk('Generated text'))
  }))
  const factory = {
    getProviderMeta: vi.fn(() => ({ requiresApiKey: false })),
    createProvider
  }
  const configService = {
    getActiveProvider: vi.fn(() => 'regular-provider'),
    getActiveMode: vi.fn(() => 'go-mode'),
    getMode: vi.fn(() => ({
      overrideProviderModel: true,
      provider: 'opencode-go',
      model: 'go-model'
    })),
    getApiKey: vi.fn(() => 'api-key'),
    getProviderConfig: vi.fn(() => ({ temperature: 0.3 })),
    getActiveSystemPrompt: vi.fn(() => 'Be concise')
  }
  const context = {
    AbortController,
    console: { error: vi.fn(), log: vi.fn() },
    module: { exports: {} },
    require: (id) => {
      if (id === 'electron') return { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }
      if (id.includes('screen-capture')) return { captureAndCompress: vi.fn() }
      if (id.includes('llm-factory')) return factory
      if (id.includes('platform-service')) return { getPlatformCapabilities: () => ({ contentProtection: false }) }
      throw new Error(`Unexpected dependency: ${id}`)
    }
  }
  const file = path.join(import.meta.dirname, '../ipc/chat-ipc.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
  context.module.exports.createChatIpcRegistrar({ configService, getMainWindow: () => null })
    .registerChatIpcHandlers()

  return { createProvider, handlers }
}

describe('OpenCode Go chat IPC', () => {
  test('passes the conversation ID to every Go provider factory call', async () => {
    const { createProvider, handlers } = chatIpcHarness()
    const conversationId = 'go_session-42'
    const event = { sender: { send: vi.fn() } }

    await handlers.get('send-message')(event, {
      text: 'Help me', conversationHistory: [], conversationId
    })
    await handlers.get('generate-summary')({}, {
      messages: [{ role: 'user', content: 'Help me' }], conversationId
    })
    await handlers.get('generate-session-title')({}, {
      assistantReply: 'Here is a helpful answer.', conversationId
    })

    expect(createProvider).toHaveBeenCalledTimes(3)
    expect(createProvider.mock.calls.map(([provider]) => provider)).toEqual([
      'opencode-go', 'opencode-go', 'opencode-go'
    ])
    expect(createProvider.mock.calls.map(([, , config]) => config)).toEqual([
      expect.objectContaining({ conversationId, systemPrompt: 'Be concise', model: 'go-model' }),
      expect.objectContaining({ conversationId, systemPrompt: '', model: 'go-model' }),
      expect.objectContaining({ conversationId, systemPrompt: '', model: 'go-model' })
    ])
  })

  test('keeps legacy summary and title payloads usable when no session ID is supplied', async () => {
    const { createProvider, handlers } = chatIpcHarness()

    await expect(handlers.get('generate-summary')({}, [
      { role: 'user', content: 'Legacy summary request' }
    ])).resolves.toMatchObject({ success: true })
    await expect(handlers.get('generate-session-title')({}, 'Legacy reply')).resolves.toMatchObject({
      success: true
    })
    expect(createProvider.mock.calls.map(([, , config]) => config.conversationId)).toEqual([
      undefined, undefined
    ])
  })
})

test('preload forwards conversation IDs with all chat requests', () => {
  const invoke = vi.fn()
  const exposeInMainWorld = vi.fn()
  const context = {
    module: { exports: {} },
    require: (id) => {
      if (id === 'electron') return {
        contextBridge: { exposeInMainWorld },
        ipcRenderer: { invoke, on: vi.fn(), send: vi.fn() }
      }
      throw new Error(`Unexpected dependency: ${id}`)
    }
  }
  const file = path.join(import.meta.dirname, '../preload.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
  const api = exposeInMainWorld.mock.calls[0][1]

  api.sendMessage('Hello', null, [], '', false, 'go_session-42')
  api.generateSummary([{ role: 'user', content: 'Hello' }], 'go_session-42')
  api.generateSessionTitle('Hello back', 'go_session-42')

  expect(invoke).toHaveBeenNthCalledWith(1, 'send-message', expect.objectContaining({
    text: 'Hello', conversationId: 'go_session-42'
  }))
  expect(invoke).toHaveBeenNthCalledWith(2, 'generate-summary', {
    messages: [{ role: 'user', content: 'Hello' }], conversationId: 'go_session-42'
  })
  expect(invoke).toHaveBeenNthCalledWith(3, 'generate-session-title', {
    assistantReply: 'Hello back', conversationId: 'go_session-42'
  })
})
