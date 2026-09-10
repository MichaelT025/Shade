# Linux / Omarchy implementation

Status: experimental, under development. No native Omarchy session has been
validated yet. Providers remain unchanged. Branch: `codex/linux-omarchy-support`.

## Build on Linux

Use a fresh Linux checkout and Node.js 22 or newer. Do not copy Windows
`node_modules`: `sharp` and libvips have platform-specific optional binaries.

```sh
npm ci --include=optional
npm run test:run
npm run build:linux
chmod +x dist/Shade-0.15.1-x64.AppImage
./dist/Shade-0.15.1-x64.AppImage
```

For debugging, `npm run build:linux:dir` produces `dist/linux-unpacked/shade`.
AppImage execution may require the distribution's FUSE compatibility package;
the unpacked build avoids that dependency. Never disable Electron's sandbox to
work around installation problems. Linux CI builds an experimental artifact; it
does not publish releases or certify Wayland behavior.

The AppImage contains `com.shade.app.desktop`. A raw AppImage does not install
that launcher into the desktop database. Use desktop integration, or create a
launcher in `~/.local/share/applications/com.shade.app.desktop` with `Exec` pointing
to the AppImage's permanent absolute path. This identity matches Shade's portal
identity. For example (replace the example paths with your own):

```ini
[Desktop Entry]
Type=Application
Name=Shade
Exec=/home/yourname/Applications/Shade-0.15.1-x64.AppImage
Icon=/home/yourname/Applications/shade.png
Terminal=false
Categories=Utility;
StartupWMClass=com.shade.app
```

Use `build/appicon.png` for the icon. Automatic desktop installation and opt-in
XDG autostart UI are still pending. No autostart entry is created by Shade.
The existing release workflow publishes Windows only; automatic updates are
disabled in experimental Linux builds with an explanation in Settings. Linux update delivery and
AppImage replacement need validation before enabling a Linux release channel.

## Runtime expectations

- A Wayland session selects native Wayland before Electron starts. X11 is a
  secondary path, not a substitute for native Wayland validation.
- Screen capture requires PipeWire and a working ScreenCast portal, normally
  `xdg-desktop-portal` plus `xdg-desktop-portal-hyprland` in Omarchy. The manual
  capture flow asks for a source; subsequent frames reuse that session. Predictive
  capture must not initiate consent. A revoked/ended session needs manual consent
  again. The portal chooses the source; Windows primary-monitor assumptions do
  not apply. Switching source currently requires restarting Shade.
- **The overlay may appear in screenshots and other screen sharing on Linux.**
  Electron does not provide Linux content protection. The corresponding setting
  is disabled, regardless of a saved Windows preference.
- Hyprland controls placement, focus, workspace visibility, and floating behavior.
  Shade requests transparency and always-on-top but cannot guarantee them. The
  overlay has the stable title `Shade Overlay` and app identity `com.shade.app`.
  Test normal behavior first; if a window rule is needed, match those identifiers
  using the syntax for your installed Hyprland version. Do not copy rules for a
  different Hyprland release without checking them.
- Global shortcuts use the portal. Wayland keeps bindings registered and ignores
  overlay-only actions while hidden. A successful registration does not prove the
  compositor assigned the requested key. Check Hyprland's portal/binding settings
  when a shortcut does not fire. Launching Shade again shows the existing overlay
  and provides a recovery route if the tray or shortcut is unavailable. An optional
  compositor exec binding can launch that same AppImage path.
- Tray integration needs a StatusNotifier host (normally Waybar's tray module).
  If Electron throws during tray creation, Shade opens its dashboard. A tray host
  that silently omits the icon still needs manual verification.
- Linux keys require an unlocked Secret Service/keyring backend. `basic_text` is
  not secure storage. Existing Windows-encrypted keys are not portable: enter
  fresh keys on Linux rather than copying the Windows config file.

## Compatibility and validation matrix

| Area | Windows | Omarchy / Wayland | Fallback / remaining validation |
| --- | --- | --- | --- |
| Tests | Baseline: 294 passed, 15 skipped (18 files) | Mocked platform tests; native run pending | CI is not an interactive compositor test |
| Packaging | NSIS baseline produced | AppImage/dir targets and Linux CI added | Linux artifact build/run pending |
| Capture | Existing screenshot-desktop path | Portal stream implementation | Consent, fresh frames, revocation, timeout, cancellation pending native test |
| Overlay | Existing opacity workaround preserved | Compositor controls placement/focus | Test floating, scaling, workspace and collapse behavior |
| Capture exclusion | Existing Electron protection | Unsupported; disabled setting | Overlay can appear in captures |
| Shortcuts | Existing accelerator behavior | Stable portal registrations | Check every binding while focused/unfocused and after relaunch |
| Tray | Existing menu | StatusNotifier/Waybar | Dashboard on creation failure; relaunch to recover hidden overlay |
| Keys | Existing storage behavior retained | Reject insecure storage | Test locked/unlocked keyring and reboot |
| Updates | Existing NSIS release path | Not released or validated | Manual experimental build replacement |
| Autostart | No change | Not implemented | Remains opt-in future work |

### Native exit gate

Record Omarchy, Hyprland, portal and Electron versions, GPU, display count and
scales. Then check fresh installation and first launch; manual portal consent;
repeated captures of visibly changing content; auto mode after manual consent;
permission denial and revoke; overlay hide/show/collapse/focus; all shortcuts;
tray and quit; API-key save/read/delete with locked and unlocked keyring; text
and screenshot conversations; streaming stop; relaunch/session restoration;
multiple monitors and 1x/fractional/2x scale. Confirm capture dimensions match
the portal stream and the chosen display. Test Windows interactively too.

This gate remains open until tested on the real Omarchy session. WSL, mocked
tests, and an Ubuntu CI packaging job cannot close it.

## References

- [Electron global shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Electron window limitations](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [Electron secure storage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Hyprland desktop portal](https://wiki.hypr.land/Hypr-Ecosystem/xdg-desktop-portal-hyprland/)
- [Hyprland global bindings](https://wiki.hypr.land/configuring/core/binds/globals/)
