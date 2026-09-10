const path = require('path')

const RESULT_CHANNEL = 'shade-wayland-capture-result'
const STATE_CHANNEL = 'shade-wayland-capture-state'
const CANCEL_CHANNEL = 'shade-wayland-capture-cancel'
const CAPTURE_PARTITION = 'shade-capture'

function captureError(message) {
  return new Error(`Wayland screen capture failed: ${message}`)
}

class WaylandCapture {
  constructor(options = {}) {
    const electron = options.electron || require('electron')
    this.BrowserWindow = options.BrowserWindow || electron.BrowserWindow
    this.ipcMain = options.ipcMain || electron.ipcMain
    this.desktopCapturer = options.desktopCapturer || electron.desktopCapturer
    this.session = options.session || electron.session
    this.timeoutMs = options.timeoutMs || 30000
    this.capturePage = options.capturePage || path.join(__dirname, '../../main/capture/capture.html')
    this.preload = options.preload || path.join(__dirname, '../../main/capture/capture-preload.js')
    this.window = null
    this.readyPromise = null
    this.streamActive = false
    this.pending = new Map()
    this.nextRequestId = 1
    this.initialized = false
    this.captureSession = null
  }

  isCaptureSender(event) {
    return Boolean(this.window && !this.window.isDestroyed() &&
      event.sender === this.window.webContents &&
      event.senderFrame === this.window.webContents.mainFrame)
  }

  initialize() {
    if (this.initialized) return
    this.initialized = true
    this.onState = (event, state) => {
      if (!this.isCaptureSender(event)) return
      this.streamActive = state === 'active'
      if (this.streamActive) this.window.hide()
    }
    this.onResult = (event, result = {}) => {
      if (!this.isCaptureSender(event)) return
      const entry = this.pending.get(result.requestId)
      if (!entry) return
      this.pending.delete(result.requestId)
      clearTimeout(entry.timer)
      entry.signal?.removeEventListener('abort', entry.onAbort)
      this.window.hide()
      if (result.error) return entry.reject(captureError(result.error))
      const buffer = Buffer.from(result.png || [])
      if (!buffer.length) return entry.reject(captureError('the portal returned an empty image'))
      entry.resolve(buffer)
    }
    this.ipcMain.on(STATE_CHANNEL, this.onState)
    this.ipcMain.on(RESULT_CHANNEL, this.onResult)
  }

  configureSession() {
    if (this.captureSession) return
    this.captureSession = this.session.fromPartition(CAPTURE_PARTITION)
    this.captureSession.setDisplayMediaRequestHandler(async (request, callback) => {
      if (!this.window || this.window.isDestroyed() || request.frame !== this.window.webContents.mainFrame) {
        callback({})
        return
      }
      try {
        const sources = await this.desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false
        })
        if (!this.window || this.window.isDestroyed() || request.frame !== this.window.webContents.mainFrame) {
          callback({})
          return
        }
        callback(sources.length ? { video: sources[0] } : {})
      } catch (error) {
        console.error('Wayland display-media request failed:', error)
        callback({})
      }
    })
  }

  async ensureWindow() {
    this.initialize()
    if (this.window && !this.window.isDestroyed()) return this.readyPromise
    this.configureSession()
    this.streamActive = false
    const captureWindow = new this.BrowserWindow({
      show: false,
      width: 440,
      height: 250,
      resizable: false,
      center: true,
      title: 'Share your screen with Shade',
      webPreferences: {
        preload: this.preload,
        session: this.captureSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    this.window = captureWindow
    captureWindow.on('closed', () => {
      if (this.window !== captureWindow) return
      this.window = null
      this.readyPromise = null
      this.streamActive = false
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer)
        entry.signal?.removeEventListener('abort', entry.onAbort)
        entry.reject(captureError('the capture helper closed unexpectedly'))
      }
      this.pending.clear()
    })
    this.readyPromise = captureWindow.loadFile(this.capturePage)
    return this.readyPromise
  }

  capture(options = {}) {
    const captureMode = typeof options.captureMode === 'string' ? options.captureMode : 'unknown'
    if (captureMode === 'predictive' && !this.streamActive) {
      return Promise.reject(captureError('screen sharing has not been authorized; take one manual screenshot first'))
    }
    if (this.pending.size > 0) return Promise.reject(captureError('another capture is already in progress'))
    if (options.signal?.aborted) return Promise.reject(captureError('capture was cancelled'))
    const requestId = this.nextRequestId++
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const entry = this.pending.get(requestId)
        if (!entry) return
        this.pending.delete(requestId)
        clearTimeout(entry.timer)
        const captureWindow = this.window
        captureWindow?.webContents.send(CANCEL_CHANNEL, requestId)
        if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy()
        reject(captureError('capture was cancelled'))
      }
      const timer = setTimeout(() => {
        const entry = this.pending.get(requestId)
        if (!entry) return
        this.pending.delete(requestId)
        entry.signal?.removeEventListener('abort', entry.onAbort)
        const captureWindow = this.window
        captureWindow?.webContents.send(CANCEL_CHANNEL, requestId)
        if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy()
        reject(captureError(`timed out after ${this.timeoutMs}ms while waiting for the screen-sharing portal`))
      }, this.timeoutMs)
      this.pending.set(requestId, { resolve, reject, timer, signal: options.signal, onAbort })
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.ensureWindow().then(() => {
        if (!this.pending.has(requestId)) return
        if (!this.streamActive && captureMode !== 'predictive') this.window.show()
        const script = `window.requestShadeCapture(${requestId}, ${captureMode !== 'predictive'})`
        return this.window.webContents.executeJavaScript(script, true)
      }).catch(error => {
        const entry = this.pending.get(requestId)
        if (!entry) return
        this.pending.delete(requestId)
        clearTimeout(entry.timer)
        entry.signal?.removeEventListener('abort', entry.onAbort)
        entry.reject(captureError(error?.message || 'the capture helper failed to load'))
      })
    })
  }

  dispose() {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
  }
}

let singleton
function getWaylandCapture() { if (!singleton) singleton = new WaylandCapture(); return singleton }
function initializeWaylandCapture() { getWaylandCapture().initialize() }
function captureWayland(options) { return getWaylandCapture().capture(options) }
function disposeWaylandCapture() { if (singleton) singleton.dispose() }

module.exports = { WaylandCapture, captureWayland, initializeWaylandCapture, disposeWaylandCapture, RESULT_CHANNEL, STATE_CHANNEL, CANCEL_CHANNEL, CAPTURE_PARTITION }
