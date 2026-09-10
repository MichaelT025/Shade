import { describe, test, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'events'

const { WaylandCapture, RESULT_CHANNEL, STATE_CHANNEL, CAPTURE_PARTITION } = await import('../capture/wayland-capture.js')

const flush = () => new Promise(resolve => setImmediate(resolve))

function makeHarness(timeoutMs = 30000, loadFile = vi.fn().mockResolvedValue(undefined)) {
  const ipcMain = new EventEmitter()
  const mainFrame = {}
  const webContents = {
    mainFrame,
    send: vi.fn(),
    executeJavaScript: vi.fn().mockResolvedValue(undefined)
  }
  let destroyed = false
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.webContents = webContents
      BrowserWindow.instance = this
    }
    loadFile = loadFile
    isDestroyed = () => destroyed
    destroy = vi.fn(() => { destroyed = true; this.emit('closed') })
    show = vi.fn()
    hide = vi.fn()
  }
  const captureSession = { setDisplayMediaRequestHandler: vi.fn() }
  const session = { fromPartition: vi.fn(() => captureSession) }
  const desktopCapturer = { getSources: vi.fn().mockResolvedValue([{ id: 'portal-source' }]) }
  const capture = new WaylandCapture({ BrowserWindow, ipcMain, session, desktopCapturer, timeoutMs })
  return { capture, ipcMain, session, captureSession, desktopCapturer, BrowserWindow, webContents, mainFrame }
}

describe('WaylandCapture', () => {
  afterEach(() => vi.useRealTimers())
  test('predictive capture never opens the portal before a stream is active', async () => {
    const h = makeHarness()
    await expect(h.capture.capture({ captureMode: 'predictive' })).rejects.toThrow('take one manual screenshot first')
    expect(h.session.fromPartition).not.toHaveBeenCalled()
  })

  test('uses an isolated session and reuses its active stream', async () => {
    const h = makeHarness()
    const first = h.capture.capture({ captureMode: 'manual' })
    await flush()
    expect(h.webContents.executeJavaScript).toHaveBeenCalled()
    expect(h.session.fromPartition).toHaveBeenCalledWith(CAPTURE_PARTITION)
    expect(h.BrowserWindow.instance.options.webPreferences.session).toBe(h.captureSession)
    expect(h.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('true'), true)

    h.ipcMain.emit(STATE_CHANNEL, { sender: h.webContents, senderFrame: h.mainFrame }, 'active')
    h.ipcMain.emit(RESULT_CHANNEL, { sender: h.webContents, senderFrame: h.mainFrame }, { requestId: 1, png: new Uint8Array([1, 2, 3]) })
    await expect(first).resolves.toEqual(Buffer.from([1, 2, 3]))

    const second = h.capture.capture({ captureMode: 'predictive' })
    await flush()
    expect(h.webContents.executeJavaScript).toHaveBeenCalledTimes(2)
    expect(h.webContents.executeJavaScript.mock.calls[1]).toEqual([expect.stringContaining('false'), true])
    h.ipcMain.emit(RESULT_CHANNEL, { sender: h.webContents, senderFrame: h.mainFrame }, { requestId: 2, png: [4] })
    await expect(second).resolves.toEqual(Buffer.from([4]))
    expect(h.BrowserWindow.instance.loadFile).toHaveBeenCalledTimes(1)
  })

  test('ignores state and results from other renderers', async () => {
    const h = makeHarness()
    const pending = h.capture.capture({ captureMode: 'manual' })
    await flush()
    expect(h.webContents.executeJavaScript).toHaveBeenCalled()
    h.ipcMain.emit(STATE_CHANNEL, { sender: {}, senderFrame: {} }, 'active')
    h.ipcMain.emit(RESULT_CHANNEL, { sender: {}, senderFrame: {} }, { requestId: 1, png: [9] })
    expect(h.capture.streamActive).toBe(false)
    expect(h.capture.pending.has(1)).toBe(true)
    h.capture.dispose()
    await expect(pending).rejects.toThrow('closed unexpectedly')
  })

  test('times out helper loading and destroys it to cancel late permission', async () => {
    vi.useFakeTimers()
    const h = makeHarness(25, vi.fn(() => new Promise(() => {})))
    const pending = h.capture.capture({ captureMode: 'manual' })
    const rejection = expect(pending).rejects.toThrow('timed out after 25ms')
    await vi.advanceTimersByTimeAsync(25)
    await rejection
    expect(h.BrowserWindow.instance.destroy).toHaveBeenCalledOnce()
    expect(h.webContents.executeJavaScript).not.toHaveBeenCalled()
  })

  test('only grants display media to the capture document', async () => {
    const h = makeHarness()
    const pending = h.capture.capture({ captureMode: 'manual' })
    await flush()
    expect(h.captureSession.setDisplayMediaRequestHandler).toHaveBeenCalled()
    const handler = h.captureSession.setDisplayMediaRequestHandler.mock.calls[0][0]
    const denied = vi.fn()
    await handler({ frame: {} }, denied)
    expect(denied).toHaveBeenCalledWith({})
    expect(h.desktopCapturer.getSources).not.toHaveBeenCalled()

    const granted = vi.fn()
    await handler({ frame: h.mainFrame }, granted)
    expect(granted).toHaveBeenCalledWith({ video: { id: 'portal-source' } })
    h.capture.dispose()
    await expect(pending).rejects.toThrow()
  })

  test('aborting destroys the capture document and allows a fresh request', async () => {
    const h = makeHarness()
    const controller = new AbortController()
    const pending = h.capture.capture({ captureMode: 'manual', signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await flush()
    controller.abort()
    await rejected
    expect(h.BrowserWindow.instance.destroy).toHaveBeenCalledOnce()
    expect(h.capture.pending.size).toBe(0)
    expect(h.capture.streamActive).toBe(false)
  })

  test('rejects overlapping requests without replacing pending consent', async () => {
    const h = makeHarness()
    const pending = h.capture.capture({ captureMode: 'manual' })
    const rejected = expect(pending).rejects.toThrow('closed unexpectedly')
    await expect(h.capture.capture({ captureMode: 'manual' })).rejects.toThrow('already in progress')
    expect(h.capture.pending.size).toBe(1)
    h.capture.dispose()
    await rejected
  })

  test('rejects a portal source arriving after the capture document closes', async () => {
    const h = makeHarness()
    let resolveSources
    h.desktopCapturer.getSources.mockReturnValue(new Promise(resolve => { resolveSources = resolve }))
    const pending = h.capture.capture({ captureMode: 'manual' })
    const rejected = expect(pending).rejects.toThrow('closed unexpectedly')
    await flush()
    const handler = h.captureSession.setDisplayMediaRequestHandler.mock.calls[0][0]
    const callback = vi.fn()
    const grant = handler({ frame: h.mainFrame }, callback)
    h.capture.dispose()
    resolveSources([{ id: 'late-source' }])
    await grant
    await rejected
    expect(callback).toHaveBeenCalledWith({})
  })
})
