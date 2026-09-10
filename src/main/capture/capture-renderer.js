const video = document.getElementById('capture-video')
const shareButton = document.getElementById('share-button')
let stream = null
let permissionRequest = null
const cancelled = new Set()

function stopStream() {
  if (stream) stream.getTracks().forEach(track => track.stop())
  stream = null
  video.srcObject = null
  window.shadeCapture.sendState('inactive')
}

async function ensureStream(allowPermission) {
  if (stream?.getVideoTracks().some(track => track.readyState === 'live')) return stream
  if (!allowPermission) throw new Error('screen sharing has not been authorized; take one manual screenshot first')
  stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
  const track = stream.getVideoTracks()[0]
  if (!track) throw new Error('the portal did not provide a video track')
  track.addEventListener('ended', stopStream, { once: true })
  video.srcObject = stream
  await video.play()
  window.shadeCapture.sendState('active')
  return stream
}

function waitForFreshFrame() {
  if (typeof video.requestVideoFrameCallback === 'function') {
    return new Promise(resolve => {
      // PipeWire can stop delivering frames when a screen is unchanged. Its
      // last decoded frame is still current; don't time out a static desktop.
      let callbackId
      const timer = setTimeout(() => {
        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          video.cancelVideoFrameCallback?.(callbackId)
          resolve()
        }
      }, 250)
      callbackId = video.requestVideoFrameCallback(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

async function captureRequest(requestId, allowPermission) {
  try {
    await ensureStream(allowPermission)
    await waitForFreshFrame()
    if (cancelled.delete(requestId)) return
    if (!video.videoWidth || !video.videoHeight) throw new Error('the screen-sharing stream has no image dimensions')
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('failed to encode the captured frame')), 'image/png')
    })
    if (cancelled.delete(requestId)) return
    window.shadeCapture.sendResult({ requestId, png: new Uint8Array(await blob.arrayBuffer()) })
  } catch (error) {
    stopStream()
    if (!cancelled.delete(requestId)) {
      window.shadeCapture.sendResult({ requestId, error: error?.message || 'screen sharing was denied or cancelled' })
    }
  }
}

shareButton.addEventListener('click', () => {
  if (!permissionRequest) return
  const request = permissionRequest
  permissionRequest = null
  shareButton.disabled = true
  captureRequest(request.requestId, true).finally(() => { shareButton.disabled = false })
})

window.shadeCapture.onCancel(requestId => {
  cancelled.add(requestId)
  if (permissionRequest?.requestId === requestId) permissionRequest = null
})
window.requestShadeCapture = (requestId, allowPermission) => {
  if (stream?.getVideoTracks().some(track => track.readyState === 'live')) {
    captureRequest(requestId, false)
    return
  }
  if (!allowPermission) {
    captureRequest(requestId, false)
    return
  }
  permissionRequest = { requestId }
  shareButton.focus()
}
