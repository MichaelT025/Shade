import { describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

function createChatIpcHarness(streamResponse, {
  captureAndCompress = vi.fn(),
  getExcludeOverlayFromScreenshots = vi.fn(() => false),
  mainWindow = null
} = {}) {
  const handlers = new Map()
  const createProvider = vi.fn(() => ({ streamResponse }))
  const factory = {
    getProviderMeta: vi.fn(() => ({ requiresApiKey: false })),
    createProvider
  }
  const configService = {
    getActiveProvider: vi.fn(() => 'test-provider'),
    getActiveMode: vi.fn(() => 'default'),
    getMode: vi.fn(() => ({})),
    getApiKey: vi.fn(() => 'test-key'),
    getProviderConfig: vi.fn(() => ({ model: 'test-model' })),
    getActiveSystemPrompt: vi.fn(() => ''),
    getExcludeOverlayFromScreenshots
  }
  const context = {
    AbortController,
    console: { error: vi.fn(), log: vi.fn() },
    setTimeout,
    module: { exports: {} },
    require: id => {
      if (id === 'electron') return { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }
      if (id.includes('screen-capture')) return { captureAndCompress }
      if (id.includes('llm-factory')) return factory
      throw new Error(`Unexpected dependency: ${id}`)
    }
  }
  const file = path.join(import.meta.dirname, '../ipc/chat-ipc.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
  context.module.exports.createChatIpcRegistrar({ configService, getMainWindow: () => mainWindow })
    .registerChatIpcHandlers()

  return { createProvider, handlers, captureAndCompress }
}

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function requestPayload(requestId) {
  return {
    text: 'Hello',
    conversationHistory: [],
    conversationId: 'conversation-1',
    requestId
  }
}

describe('chat IPC request lifecycle', () => {
  test('late completion of request A does not clear request B controller', async () => {
    const pending = []
    const streamResponse = vi.fn((_text, _image, _history, onChunk, signal) => new Promise(resolve => {
      pending.push({ onChunk, resolve, signal })
    }))
    const { handlers } = createChatIpcHarness(streamResponse)
    const event = { sender: { send: vi.fn() } }
    const sendMessage = handlers.get('send-message')

    const requestA = sendMessage(event, requestPayload('request-a'))
    const requestB = sendMessage(event, requestPayload('request-b'))
    await Promise.resolve()

    expect(pending).toHaveLength(2)
    expect(pending[0].signal.aborted).toBe(true)

    pending[0].resolve()
    await requestA

    const stopResult = await handlers.get('stop-message')({}, 'request-b')
    expect(stopResult).toMatchObject({ success: true, requestId: 'request-b' })
    expect(pending[1].signal.aborted).toBe(true)

    pending[1].resolve()
    await requestB

    const terminals = event.sender.send.mock.calls
      .filter(([name]) => name === 'message-complete')
      .map(([, payload]) => payload)
    expect(terminals).toEqual([
      { requestId: 'request-a', status: 'aborted' },
      { requestId: 'request-b', status: 'aborted' }
    ])
  })

  test('aborting a gateway-like stream emits one aborted terminal event after a partial chunk', async () => {
    const streamResponse = vi.fn((_text, _image, _history, onChunk, signal) => {
      onChunk('partial answer')
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true })
      })
    })
    const { handlers } = createChatIpcHarness(streamResponse)
    const event = { sender: { send: vi.fn() } }

    const sendPromise = handlers.get('send-message')(event, requestPayload('gateway-request'))
    await Promise.resolve()

    await expect(handlers.get('stop-message')({}, 'gateway-request')).resolves.toMatchObject({ success: true })
    await expect(sendPromise).resolves.toMatchObject({ success: true, aborted: true })

    expect(event.sender.send).toHaveBeenNthCalledWith(1, 'message-chunk', {
      requestId: 'gateway-request',
      chunk: 'partial answer'
    })
    expect(event.sender.send).toHaveBeenNthCalledWith(2, 'message-complete', {
      requestId: 'gateway-request',
      status: 'aborted'
    })
    expect(event.sender.send.mock.calls.filter(([name]) => name === 'message-complete')).toHaveLength(1)
  })

  test('stop aborts an in-flight summary preparation request', async () => {
    const pending = []
    const streamResponse = vi.fn((_text, _image, _history, _onChunk, signal) => new Promise(resolve => {
      pending.push({ resolve, signal })
    }))
    const { handlers } = createChatIpcHarness(streamResponse)

    const summaryPromise = handlers.get('generate-summary')({}, {
      messages: [{ role: 'user', content: 'Hello' }],
      conversationId: 'conversation-1',
      requestId: 'summary-request'
    })
    await Promise.resolve()

    await expect(handlers.get('stop-message')({}, 'summary-request')).resolves.toMatchObject({ success: true })
    expect(pending[0].signal.aborted).toBe(true)

    pending[0].resolve()
    await expect(summaryPromise).resolves.toMatchObject({ success: false, aborted: true })
  })

  test('keeps capture protection active until all overlapping captures finish', async () => {
    vi.useFakeTimers()

    try {
      const pendingCaptures = []
      const captureAndCompress = vi.fn(({ captureMode }) => {
        const capture = createDeferred()
        pendingCaptures.push({ captureMode, ...capture })
        return capture.promise
      })
      const mainWindow = { setContentProtection: vi.fn() }
      const { handlers } = createChatIpcHarness(undefined, {
        captureAndCompress,
        mainWindow
      })
      const captureScreen = handlers.get('capture-screen')

      const manualPromise = captureScreen({}, { captureMode: 'manual' })
      const sendPromise = captureScreen({}, { captureMode: 'send' })
      await Promise.resolve()

      expect(pendingCaptures).toHaveLength(0)
      expect(mainWindow.setContentProtection).toHaveBeenCalledWith(true)

      await vi.advanceTimersByTimeAsync(59)
      expect(pendingCaptures).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(1)
      expect(pendingCaptures.map(({ captureMode }) => captureMode)).toEqual(['manual', 'send'])

      await expect(captureScreen({}, { captureMode: 'predictive' })).resolves.toEqual({
        success: false,
        error: 'Capture already in progress'
      })
      expect(mainWindow.setContentProtection).toHaveBeenCalledTimes(1)

      pendingCaptures[1].reject(new Error('send failed'))
      await expect(sendPromise).resolves.toEqual({ success: false, error: 'send failed' })
      expect(mainWindow.setContentProtection).toHaveBeenCalledTimes(1)

      pendingCaptures[0].resolve({ base64: 'manual-image', size: 12 })
      await expect(manualPromise).resolves.toEqual({
        success: true,
        base64: 'manual-image',
        size: 12
      })
      expect(mainWindow.setContentProtection).toHaveBeenNthCalledWith(2, false)
      expect(mainWindow.setContentProtection).toHaveBeenCalledTimes(2)
      expect(captureAndCompress).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
