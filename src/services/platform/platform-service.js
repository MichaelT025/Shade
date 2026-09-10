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
    // Linux artifacts are experimental until the native exit gate and release
    // feed/replacement checks pass. Do not poll the Windows-only release feed.
    automaticUpdates: !isLinux,
    updateMessage: isLinux ? 'Linux updates are not available yet. Install a newer experimental build manually.' : '',
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
