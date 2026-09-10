// Keep runtime capabilities separate from user preferences. A saved Windows
// preference must never be interpreted as working protection on Linux.
function getPlatformCapabilities(platform = process.platform, env = process.env) {
  const isLinux = platform === 'linux'
  const isWayland = isLinux && (env.XDG_SESSION_TYPE === 'wayland' || !!env.WAYLAND_DISPLAY)
  return {
    platform,
    isWayland,
    contentProtection: platform === 'win32' || platform === 'darwin',
    windowsShowWorkaround: platform === 'win32',
    compositorControlsPlacement: isWayland,
    shortcutBackend: isWayland ? 'desktop-portal' : 'native',
    contentProtectionMessage: isLinux
      ? 'Unavailable on Linux: the Shade overlay may appear in screenshots and screen sharing.'
      : ''
  }
}

function configurePlatform(app, platform = process.platform, env = process.env) {
  const capabilities = getPlatformCapabilities(platform, env)
  if (platform === 'win32') {
    app.commandLine.appendSwitch('enable-features', 'CalculateNativeWinOcclusion')
  }
  if (platform === 'linux') {
    app.setDesktopName('com.shade.app.desktop')
    if (capabilities.isWayland) {
      // Native Wayland is the supported Omarchy path; do not fall back silently.
      app.commandLine.appendSwitch('ozone-platform', 'wayland')
      app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
    }
  }
  return capabilities
}

module.exports = { getPlatformCapabilities, configurePlatform }
