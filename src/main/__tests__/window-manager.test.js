import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'

function windowHarness() {
  const ipcMain = new EventEmitter()
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super()
      this.bounds = options
      this.visible = false
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler: vi.fn(), send: vi.fn()
      })
    }
    isDestroyed() { return false }
    isVisible() { return this.visible }
    isMinimized() { return false }
    getBounds() { return this.bounds }
    setBounds(bounds) { this.bounds = bounds }
    setMinimumSize() {}
    setContentProtection() {}
    setOpacity() {}
    loadFile() {}
    focus() {}
    showInactive() {
      if (this.visible) return
      this.visible = true
      this.emit('show')
    }
    hide() {
      if (!this.visible) return
      this.visible = false
      this.emit('hide')
    }
  }
  const file = path.join(import.meta.dirname, '../windows/window-manager.js')
  const context = {
    module: { exports: {} }, __dirname: path.dirname(file),
    console: { log: vi.fn() }, setTimeout, clearTimeout,
    require: (id) => {
      if (id === 'path') return path
      if (id === 'electron') return {
        BrowserWindow: FakeWindow, ipcMain,
        screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
      }
      throw new Error(`Unexpected dependency: ${id}`)
    }
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file })
  const onOverlayShow = vi.fn()
  const onOverlayHide = vi.fn()
  const manager = context.module.exports.createWindowManager({
    rendererPath: '/renderer', getIconPath: () => '', onOverlayShow, onOverlayHide
  })
  manager.createMainWindow()
  return { manager, ipcMain, onOverlayShow, onOverlayHide }
}

describe('overlay shortcut visibility lifecycle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('registers shortcuts on first renderer-ready show and after hide/unhide', () => {
    const { manager, ipcMain, onOverlayShow, onOverlayHide } = windowHarness()
    expect(onOverlayShow).not.toHaveBeenCalled()
    ipcMain.emit('renderer-ready', {}, {})
    expect(onOverlayShow).toHaveBeenCalledTimes(1)
    manager.hideMainWindow('test')
    expect(onOverlayHide).toHaveBeenCalledTimes(1)
    manager.showMainWindow('test')
    expect(onOverlayShow).toHaveBeenCalledTimes(2)
  })

  test('registers shortcuts when the startup safety timeout shows the overlay', () => {
    const { onOverlayShow } = windowHarness()
    vi.advanceTimersByTime(4000)
    expect(onOverlayShow).toHaveBeenCalledTimes(1)
  })

  test.each(['resumeSessionInOverlay', 'startNewChatInOverlay'])('%s registers shortcuts when revealing a hidden overlay', (method) => {
    const { manager, onOverlayShow } = windowHarness()
    manager[method]('session-id')
    expect(onOverlayShow).toHaveBeenCalledTimes(1)
  })

  test('minimize-to-hide and closing release overlay shortcuts', () => {
    const { manager, ipcMain, onOverlayHide } = windowHarness()
    ipcMain.emit('renderer-ready', {}, {})
    const win = manager.getMainWindow()
    const event = { preventDefault: vi.fn() }
    win.emit('minimize', event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(onOverlayHide).toHaveBeenCalledTimes(1)
    manager.showMainWindow('test')
    win.emit('closed')
    expect(onOverlayHide).toHaveBeenCalledTimes(2)
  })
})
