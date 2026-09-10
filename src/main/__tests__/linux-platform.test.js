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
