const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shadeCapture', {
  onCancel: (callback) => ipcRenderer.on('shade-wayland-capture-cancel', (_event, requestId) => callback(requestId)),
  sendResult: (result) => ipcRenderer.send('shade-wayland-capture-result', result),
  sendState: (state) => ipcRenderer.send('shade-wayland-capture-state', state)
})
