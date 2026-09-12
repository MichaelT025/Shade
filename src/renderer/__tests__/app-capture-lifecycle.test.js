import { describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

function sourceSegment(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function classList() {
  return { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() }
}

function deferred() {
  let resolve
  const promise = new Promise(result => { resolve = result })
  return { promise, resolve }
}

function createRendererFixture() {
  const source = fs.readFileSync(path.join(import.meta.dirname, '../app.js'), 'utf8').replace(/\r\n/g, '\n')
  expect(source).toContain('let captureLifecycleVersion = 0')
  expect(source).toContain('let predictiveCaptureVersion = 0')
  const capture = deferred()
  const sendMessage = vi.fn(async () => ({ success: true, provider: 'test' }))
  const stopMessage = vi.fn(async () => ({ success: true }))
  const clearPredictiveScreenshot = vi.fn(async () => ({ success: true }))
  const click = vi.fn()
  const element = {
    classList: classList(),
    setAttribute: vi.fn(),
    focus: vi.fn(),
    appendChild: vi.fn(),
    remove: vi.fn(),
    title: '',
    disabled: false,
    value: '',
    placeholder: ''
  }
  const context = {
    console,
    Date,
    clearTimeout,
    setTimeout,
    requestSequence: 0,
    lifecycleVersion: 0,
    captureLifecycleVersion: 0,
    captureSequence: 0,
    activeRequest: null,
    activeManualCapture: null,
    currentConversationId: 'old-chat',
    currentSessionId: null,
    capturedScreenshot: null,
    capturedThumbnail: null,
    isScreenshotActive: false,
    isGenerating: false,
    screenshotMode: 'manual',
    predictiveCaptureVersion: 0,
    predictiveCaptureTimer: null,
    predictiveCaptureInProgress: false,
    predictiveCapturePromise: null,
    predictiveScreenshot: null,
    predictiveScreenshotTimestamp: null,
    PREDICTIVE_SCREENSHOT_MAX_AGE: 15000,
    messages: [],
    memoryManager: null,
    excludeScreenshotsFromMemory: true,
    sessionAutoTitleApplied: false,
    sessionLoadVersion: 0,
    sessionSaveTimer: null,
    appLogoSrc: 'logo.png',
    currentLoadingId: null,
    currentStreamingMessageId: null,
    accumulatedText: '',
    sendBtn: { ...element, click },
    screenshotBtn: { ...element },
    messageInput: { ...element },
    inputContainer: { ...element },
    messagesContainer: { ...element, innerHTML: '', querySelector: vi.fn(() => null) },
    chatWrapper: { ...element },
    modeDropdownInput: { value: '' },
    document: {
      hidden: false,
      getElementById: vi.fn(() => ({ ...element })),
      createElement: vi.fn(() => ({ ...element })),
      querySelector: vi.fn(() => null)
    },
    window: {
      electronAPI: {
        captureScreen: vi.fn(() => capture.promise),
        clearPredictiveScreenshot,
        stopMessage,
        getActiveModelCapabilities: vi.fn(async () => ({ disabled: false, strict: false, vision: true })),
        sendMessage,
        getScreenshot: vi.fn(),
        consumePredictiveScreenshot: vi.fn()
      }
    },
    insertIcon: vi.fn(),
    clearScreenshotChip: vi.fn(),
    autosizeMessageInput: vi.fn(),
    expand: vi.fn(),
    addMessage: vi.fn(),
    addLoadingMessage: vi.fn(() => 'loading'),
    removeLoadingMessage: vi.fn(),
    scrollToBottom: vi.fn(),
    showToast: vi.fn(),
    showError: vi.fn(),
    normalizeSessionMessages: messages => messages,
    renderMarkdown: text => text,
    addCopyButtons: vi.fn(),
    addMessageCopyButton: vi.fn(),
    setupScreenshotPreview: vi.fn(),
    legacyConversationId: session => session.conversationId,
    createConversationId: vi.fn(() => 'new-chat'),
    generateMessageId: vi.fn(() => 'message-id'),
    safePathPart: value => value,
    scheduleSessionSave: vi.fn(),
    removeScreenshot: vi.fn(),
    clearPredictiveScreenshot: undefined
  }
  context.clearPredictiveScreenshot = () => {
    context.predictiveScreenshot = null
    context.predictiveScreenshotTimestamp = null
    return clearPredictiveScreenshot()
  }
  vm.createContext(context)
  vm.runInContext(
    sourceSegment(source, 'function createRequestId()', '// Behavior settings') + '\n' +
    sourceSegment(source, 'function isManualCaptureCurrent(capture)', 'function schedulePredictiveCapture(') + '\n' +
    sourceSegment(source, 'async function performPredictiveCapture(forceFresh = false)', 'function isPredictiveScreenshotFresh()') + '\n' +
    sourceSegment(source, 'function isPredictiveScreenshotFresh()', 'function removeScreenshot()') + '\n' +
    sourceSegment(source, 'function resetSendButton()', '/**\n * Handle sending a message') + '\n' +
    sourceSegment(source, 'async function handleQuickScreenshotSend()', '/**\n * Setup hover preview for screenshot metadata') + '\n' +
    sourceSegment(source, 'function handleNewChat()', '/**\n * Load modes'),
    context
  )
  return { context, capture, sendMessage, stopMessage, clearPredictiveScreenshot, click }
}

function ctrlEnter() {
  return { key: 'Enter', ctrlKey: true, shiftKey: false, preventDefault: vi.fn() }
}

describe('renderer capture lifecycle (REV-01)', () => {
  test('Ctrl+Enter owns the pending capture and does not send after New Chat', async () => {
    const { context, capture, sendMessage, click } = createRendererFixture()
    const event = ctrlEnter()

    const quickSend = context.handleMessageInputKeydown(event)
    await Promise.resolve()
    expect(context.activeRequest).not.toBeNull()
    expect(context.messageInput.disabled).toBe(true)
    expect(click).not.toHaveBeenCalled()

    context.handleNewChat()
    capture.resolve({ success: true, base64: 'old-screen', thumbnail: 'old-thumb' })
    await quickSend

    expect(context.capturedScreenshot).toBeNull()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })

  test('a second Ctrl+Enter while capture is pending cannot stop or replace the first request', async () => {
    const { context, capture, sendMessage, stopMessage } = createRendererFixture()

    const first = context.handleMessageInputKeydown(ctrlEnter())
    const second = context.handleMessageInputKeydown(ctrlEnter())
    await Promise.resolve()
    expect(context.window.electronAPI.captureScreen).toHaveBeenCalledTimes(1)
    expect(stopMessage).not.toHaveBeenCalled()

    capture.resolve({ success: true, base64: 'screen', thumbnail: 'thumb' })
    await Promise.all([first, second])

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(stopMessage).not.toHaveBeenCalled()
  })

  test('a standalone capture resolving after Stop cannot attach an image', async () => {
    const { context, capture } = createRendererFixture()

    const manualCapture = context.handleScreenshotCapture()
    await Promise.resolve()
    await context.stopActiveRequest()
    capture.resolve({ success: true, base64: 'stale-screen' })
    await manualCapture

    expect(context.capturedScreenshot).toBeNull()
    expect(context.isScreenshotActive).toBe(false)
  })

  test('a denied screenshot preflight restores the composer after Ctrl+Enter capture', async () => {
    const { context, capture, sendMessage } = createRendererFixture()
    context.window.electronAPI.getActiveModelCapabilities.mockResolvedValue({
      disabled: true,
      strict: true,
      vision: false,
      reason: 'No screenshots'
    })

    const quickSend = context.handleMessageInputKeydown(ctrlEnter())
    await Promise.resolve()
    capture.resolve({ success: true, base64: 'screen', thumbnail: 'thumb' })
    await quickSend

    expect(sendMessage).not.toHaveBeenCalled()
    expect(context.activeRequest).toBeNull()
    expect(context.messageInput.disabled).toBe(false)
  })

  test('a predictive capture cannot repopulate the cache after its conversation is invalidated', async () => {
    const { context, capture, clearPredictiveScreenshot } = createRendererFixture()
    context.screenshotMode = 'auto'

    const predictiveCapture = context.performPredictiveCapture()
    await Promise.resolve()
    context.invalidateActiveRequest()
    context.currentConversationId = 'new-chat'
    capture.resolve({ success: true, cachedAt: Date.now() })
    await predictiveCapture

    expect(context.predictiveScreenshot).toBeNull()
    expect(clearPredictiveScreenshot).toHaveBeenCalled()
  })
})
