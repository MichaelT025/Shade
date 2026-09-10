import { describe, expect, test, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import vm from 'node:vm'

function rendererHarness() {
  const events = {}
  const trackEvents = {}
  const results = []
  const waiters = []
  const track = { readyState: 'live', stop: vi.fn(),
    addEventListener: (name, fn) => { trackEvents[name] = fn } }
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] }
  const getDisplayMedia = vi.fn(async () => stream)
  const button = { focus: vi.fn(), disabled: false,
    addEventListener: (name, fn) => { events[name] = fn } }
  const video = { videoWidth: 3840, videoHeight: 2160, readyState: 2, srcObject: null,
    play: vi.fn(async () => {}),
    requestVideoFrameCallback: vi.fn(fn => queueMicrotask(fn)) }
  const canvases = []
  const sendState = vi.fn()
  const context = {
    console, Uint8Array, setTimeout, clearTimeout,
    navigator: { mediaDevices: { getDisplayMedia } },
    document: {
      getElementById: id => id === 'capture-video' ? video : button,
      createElement: () => {
        const canvas = { getContext: () => ({ drawImage: vi.fn() }),
          toBlob: fn => fn({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) }
        canvases.push(canvas)
        return canvas
      }
    },
    window: { shadeCapture: {
      onCancel: fn => { events.cancel = fn }, sendState,
      sendResult: result => {
        results.push(result)
        waiters.shift()?.(result)
      }
    } }
  }
  vm.runInNewContext(fs.readFileSync(new URL('../../main/capture/capture-renderer.js', import.meta.url), 'utf8'), context)
  return { getDisplayMedia, video, button, canvases, track, sendState, results,
    request: context.window.requestShadeCapture, click: () => events.click(),
    revoke: () => { track.readyState = 'ended'; trackEvents.ended() },
    result: () => new Promise(resolve => waiters.push(resolve)) }
}

describe('Wayland capture renderer', () => {
  afterEach(() => vi.useRealTimers())
  test('asks for consent only on button click and reuses the stream at native dimensions', async () => {
    const h = rendererHarness()
    h.request(1, true)
    expect(h.getDisplayMedia).not.toHaveBeenCalled()
    const first = h.result()
    h.click()
    expect(await first).toMatchObject({ requestId: 1, png: new Uint8Array([1, 2, 3]) })
    expect(h.canvases[0]).toMatchObject({ width: 3840, height: 2160 })
    expect(h.sendState).toHaveBeenCalledWith('active')
    const second = h.result()
    h.request(2, false)
    expect(await second).toMatchObject({ requestId: 2 })
    expect(h.getDisplayMedia).toHaveBeenCalledOnce()
    expect(h.video.requestVideoFrameCallback).toHaveBeenCalledTimes(2)
  })

  test('predictive capture never opens a permission request', async () => {
    const h = rendererHarness()
    const result = h.result()
    h.request(1, false)
    expect((await result).error).toContain('manual screenshot first')
    expect(h.getDisplayMedia).not.toHaveBeenCalled()
  })

  test('revocation stops capture and predictive mode cannot reauthorize', async () => {
    const h = rendererHarness()
    const first = h.result()
    h.request(1, true)
    h.click()
    await first
    h.revoke()
    expect(h.track.stop).toHaveBeenCalledOnce()
    expect(h.video.srcObject).toBeNull()
    const next = h.result()
    h.request(2, false)
    expect((await next).error).toContain('manual screenshot first')
    expect(h.getDisplayMedia).toHaveBeenCalledOnce()
  })

  test('failed playback stops the newly authorized stream', async () => {
    const h = rendererHarness()
    h.video.play.mockRejectedValue(new Error('PipeWire stream failed'))
    const result = h.result()
    h.request(1, true)
    h.click()
    expect((await result).error).toContain('PipeWire stream failed')
    expect(h.track.stop).toHaveBeenCalledOnce()
    expect(h.sendState).not.toHaveBeenCalledWith('active')
  })

  test('uses the last decoded frame when PipeWire has no screen damage to send', async () => {
    vi.useFakeTimers()
    const h = rendererHarness()
    h.video.requestVideoFrameCallback.mockImplementation(() => 1)
    const result = h.result()
    h.request(1, true)
    h.click()
    await vi.advanceTimersByTimeAsync(250)
    expect(await result).toMatchObject({ requestId: 1 })
    expect(h.canvases[0]).toMatchObject({ width: 3840, height: 2160 })
  })
})
