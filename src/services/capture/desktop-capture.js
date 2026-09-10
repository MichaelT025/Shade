const screenshot = require('screenshot-desktop')

async function captureDesktop() {
  return screenshot({ format: 'png' })
}

module.exports = { captureDesktop }
