import { describe, expect, test, vi } from 'vitest'
import platformService from '../platform-service.js'

const { getPlatformCapabilities, configurePlatform } = platformService

describe('platform capabilities and bootstrap', () => {
  test('Linux never advertises content protection, including X11', () => {
    expect(getPlatformCapabilities('linux', {}).contentProtection).toBe(false)
    expect(getPlatformCapabilities('linux', { WAYLAND_DISPLAY: 'wayland-1' })).toMatchObject({
      contentProtection: false, isWayland: true, shortcutBackend: 'desktop-portal'
    })
  })

  test('preserves the Windows compositor workaround without Linux switches', () => {
    const app = { commandLine: { appendSwitch: vi.fn() }, setDesktopName: vi.fn() }
    configurePlatform(app, 'win32', {})
    expect(app.commandLine.appendSwitch).toHaveBeenCalledExactlyOnceWith('enable-features', 'CalculateNativeWinOcclusion')
    expect(app.setDesktopName).not.toHaveBeenCalled()
  })

  test('sets a stable portal identity and selects native Wayland before ready', () => {
    const app = { commandLine: { appendSwitch: vi.fn() }, setDesktopName: vi.fn() }
    configurePlatform(app, 'linux', { XDG_SESSION_TYPE: 'wayland' })
    expect(app.setDesktopName).toHaveBeenCalledWith('com.shade.app.desktop')
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('ozone-platform', 'wayland')
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith('enable-features', 'GlobalShortcutsPortal')
  })
})
