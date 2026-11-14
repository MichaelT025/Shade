import { describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

function shortcutHarness() {
  const source = fs.readFileSync(path.join(import.meta.dirname, '../main.js'), 'utf8')
  const callbacks = new Map()
  const win = {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    isFocused: vi.fn(() => false),
    webContents: { send: vi.fn() }
  }
  const context = {
    console, process: { platform: 'win32' },
    overlayShortcuts: new Map(),
    globalShortcut: {
      register: vi.fn((key, callback) => { callbacks.set(key, callback); return true }),
      unregister: vi.fn(key => callbacks.delete(key))
    },
    windowManager: { getMainWindow: () => win, focusComposer: vi.fn() },
    showMainWindow: vi.fn(), hideMainWindow: vi.fn()
  }
  const start = source.indexOf('function registerOverlayShortcuts()')
  const end = source.indexOf('const hasSingleInstanceLock', start)
  vm.createContext(context)
  vm.runInContext(source.slice(start, end), context)
  return { context, win, callbacks }
}

describe('overlay shortcuts while another application is active', () => {
  test('Ctrl+Shift+/ focuses the composer without hiding or showing the overlay', () => {
    const { context, callbacks } = shortcutHarness()
    context.registerOverlayShortcuts()
    callbacks.get('CommandOrControl+Shift+/')()
    expect(context.windowManager.focusComposer).toHaveBeenCalledTimes(1)
    expect(context.showMainWindow).not.toHaveBeenCalled()
    expect(context.hideMainWindow).not.toHaveBeenCalled()
  })

  test.each([false, true])('Ctrl+/ hides a visible overlay with focused=%s and shows a hidden one', (focused) => {
    const { context, win, callbacks } = shortcutHarness()
    context.registerHotkeys()
    win.isFocused.mockReturnValue(focused)
    callbacks.get('CommandOrControl+/')()
    expect(context.hideMainWindow).toHaveBeenCalledTimes(1)
    expect(context.windowManager.focusComposer).not.toHaveBeenCalled()
    win.isVisible.mockReturnValue(false)
    callbacks.get('CommandOrControl+/')()
    expect(context.showMainWindow).toHaveBeenCalledTimes(1)
  })

  test('Ctrl+Enter dispatches one send without focusing the overlay', () => {
    const { context, win, callbacks } = shortcutHarness()
    context.registerOverlayShortcuts()
    context.registerOverlayShortcuts()
    callbacks.get('CommandOrControl+Enter')()
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith('quick-screenshot-send')
    expect(context.windowManager.focusComposer).not.toHaveBeenCalled()
    expect(context.globalShortcut.register.mock.calls.filter(([key]) => key === 'CommandOrControl+Enter')).toHaveLength(1)
  })

  test('quick send guards against a hidden or destroyed overlay and unregisters on hide', () => {
    const { context, win, callbacks } = shortcutHarness()
    context.registerOverlayShortcuts()
    win.isVisible.mockReturnValue(false)
    callbacks.get('CommandOrControl+Enter')()
    win.isVisible.mockReturnValue(true)
    win.isDestroyed.mockReturnValue(true)
    callbacks.get('CommandOrControl+Enter')()
    expect(win.webContents.send).not.toHaveBeenCalled()
    context.unregisterOverlayShortcuts()
    expect(callbacks.has('CommandOrControl+Enter')).toBe(false)
    expect(callbacks.has('CommandOrControl+Shift+/')).toBe(false)
    expect(context.overlayShortcuts.size).toBe(0)
  })
})
