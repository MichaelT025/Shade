import { describe, test, expect, vi } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import platformService from '../../services/platform/platform-service.js'

// Execute the real CommonJS IPC module with injected Electron dependencies.
function configHandlers(platform) {
  const handlers = new Map()
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) }
  const configService = {
    getExcludeOverlayFromScreenshots: () => true,
    setExcludeOverlayFromScreenshots: vi.fn(),
    getExcludeScreenshotsFromMemory: () => true
  }
  const win = { isDestroyed: () => false, setContentProtection: vi.fn() }
  const context = {
    module: { exports: {} }, console,
    require: (id) => {
      if (id === 'electron') return { ipcMain }
      if (id.includes('platform-service')) return {
        getPlatformCapabilities: () => platformService.getPlatformCapabilities(platform, {})
      }
      if (id.includes('llm-factory')) return {}
      throw new Error(`Unexpected dependency ${id}`)
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(import.meta.dirname, '../ipc/config-ipc.js'), 'utf8'), context)
  context.module.exports.registerConfigIpcHandlers({ configService,
    getMainWindow: () => win, sendToWindows: vi.fn(), broadcastConfigChanged: vi.fn() })
  return { handlers, configService, win }
}

describe('platform protection IPC', () => {
  test('Linux reports unsupported despite a saved enabled Windows preference', async () => {
    const { handlers, configService, win } = configHandlers('linux')
    expect(await handlers.get('get-exclude-overlay-from-screenshots')()).toMatchObject({
      success: true, supported: false, exclude: false
    })
    expect(await handlers.get('set-exclude-overlay-from-screenshots')({}, true)).toMatchObject({ success: false })
    expect(configService.setExcludeOverlayFromScreenshots).not.toHaveBeenCalled()
    expect(win.setContentProtection).not.toHaveBeenCalled()
    // Screenshot retention is independent of content protection.
    expect(await handlers.get('get-exclude-screenshots-from-memory')()).toEqual({ success: true, exclude: true })
  })

  test('Windows applies and persists protection normally', async () => {
    const { handlers, configService, win } = configHandlers('win32')
    expect(await handlers.get('set-exclude-overlay-from-screenshots')({}, true)).toEqual({ success: true })
    expect(configService.setExcludeOverlayFromScreenshots).toHaveBeenCalledWith(true)
    expect(win.setContentProtection).toHaveBeenCalledWith(true)
  })
})

function shortcutHarness(platform) {
  const callbacks = new Map()
  const globalShortcut = {
    register: vi.fn((key, fn) => { callbacks.set(key, fn); return true }),
    unregister: vi.fn(), unregisterAll: vi.fn()
  }
  const win = { isVisible: vi.fn(() => true), isMinimized: () => false,
    webContents: { send: vi.fn() } }
  const manager = { getMainWindow: () => win, toggleModelSwitcherWindow: vi.fn() }
  const dialog = { showMessageBox: vi.fn(async () => ({})) }
  const app = { commandLine: { appendSwitch: vi.fn() }, setDesktopName: vi.fn(),
    requestSingleInstanceLock: () => true, on: vi.fn(),
    whenReady: () => ({ then: () => {} }), isPackaged: false }
  const context = vm.createContext({ console, manager, process: {
    platform, env: platform === 'linux' ? { XDG_SESSION_TYPE: 'wayland' } : {}
  }, __dirname: import.meta.dirname, require: (id) => {
    if (id === 'electron') return { app, globalShortcut, dialog }
    if (id === 'path') return path
    if (id.includes('platform-service')) return {
      configurePlatform: () => platformService.getPlatformCapabilities(platform,
        platform === 'linux' ? { XDG_SESSION_TYPE: 'wayland' } : {})
    }
    return {}
  } })
  vm.runInContext(fs.readFileSync(path.join(import.meta.dirname, '../main.js'), 'utf8'), context)
  vm.runInContext('windowManager = manager', context)
  return { callbacks, globalShortcut, win, dialog,
    run: (code) => vm.runInContext(code, context) }
}

describe('Wayland shortcut lifecycle', () => {
  test('keeps bindings across hide/show while gating callbacks by visibility', () => {
    const { run, callbacks, globalShortcut, win } = shortcutHarness('linux')
    run('registerOverlayShortcuts()')
    expect(globalShortcut.register).toHaveBeenCalledTimes(4)
    callbacks.get('CommandOrControl+R')()
    expect(win.webContents.send).toHaveBeenCalledWith('new-chat')
    win.webContents.send.mockClear()
    win.isVisible.mockReturnValue(false)
    run('unregisterOverlayShortcuts()')
    callbacks.get('CommandOrControl+R')()
    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(globalShortcut.unregister).not.toHaveBeenCalled()
    run('registerOverlayShortcuts()')
    expect(globalShortcut.register).toHaveBeenCalledTimes(4)
  })

  test('Windows still unregisters overlay bindings when hidden', () => {
    const { run, globalShortcut } = shortcutHarness('win32')
    run('registerOverlayShortcuts(); unregisterOverlayShortcuts()')
    expect(globalShortcut.unregister).toHaveBeenCalledTimes(4)
  })

  test('reports failed registrations once per accelerator', () => {
    const { run, globalShortcut, dialog } = shortcutHarness('linux')
    globalShortcut.register.mockReturnValue(false)
    run('registerOverlayShortcuts(); registerOverlayShortcuts()')
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(4)
    expect(dialog.showMessageBox.mock.calls[0][0].message).toContain('GlobalShortcuts portal')
  })
})

test('experimental Linux builds do not contact the Windows update feed', async () => {
  const autoUpdater = { checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() }
  const context = { module: { exports: {} }, require: (id) => {
    if (id === 'electron') return { app: { isPackaged: true } }
    if (id === 'electron-updater') return { autoUpdater }
    if (id === 'electron-log') return {}
    if (id.includes('platform-service')) return {
      getPlatformCapabilities: () => platformService.getPlatformCapabilities('linux', {})
    }
    throw new Error(`Unexpected dependency ${id}`)
  } }
  vm.runInNewContext(fs.readFileSync(path.join(import.meta.dirname, '../services/update-service.js'), 'utf8'), context)
  const service = context.module.exports.createUpdateService({
    configService: { getAutoUpdateEnabled: () => true }, sendToWindows: vi.fn()
  })
  service.init()
  expect(service.getStatus()).toMatchObject({ status: 'unsupported', autoUpdateEnabled: false })
  expect(await service.checkForUpdates()).toMatchObject({ success: false, status: 'unsupported' })
  expect(await service.downloadUpdate()).toMatchObject({ success: false })
  expect(service.quitAndInstall()).toMatchObject({ success: false })
  expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
})
