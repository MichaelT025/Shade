const sharp = require('sharp')
const screenshot = require('screenshot-desktop')
const fs = require('fs')
const path = require('path')

/**
 * Captures a screenshot of the primary display.
 * Windows with setContentProtection(true) are automatically excluded from capture
 * Multi-display selection is intentionally disabled for v1.
 * @returns {Promise<Buffer>} Screenshot as a buffer
 */
async function captureScreen(options = {}) {
  try {
    const captureMode = typeof options.captureMode === 'string' ? options.captureMode : 'unknown'
    const pngBuffer = await screenshot({ format: 'png' })

    if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) {
      throw new Error('Screenshot capture returned an invalid image buffer')
    }

    console.log('Screenshot captured successfully using screenshot-desktop', { captureMode })
    return pngBuffer
  } catch (error) {
    console.error('Error capturing screenshot:', error)
    throw new Error(`Failed to capture screenshot: ${error.message}`)
  }
}

/**
 * Compresses an image buffer to reduce file size for API transmission
 * Target: Keep under 5MB, optimize for Gemini API
 * @param {Buffer} imageBuffer - Original image buffer
 * @returns {Promise<{buffer: Buffer, base64: string, size: number}>} Compressed image data
 */
async function compressImage(imageBuffer, options = {}) {
  try {
    const captureMode = typeof options.captureMode === 'string' ? options.captureMode : 'unknown'
    const isPredictiveCapture = captureMode === 'predictive'
    const metadata = await sharp(imageBuffer).metadata()

    // Target max size: 5MB
    const MAX_SIZE = 5 * 1024 * 1024

    // If image is already small enough, just convert to JPEG with quality 85
    if (imageBuffer.length < MAX_SIZE) {
      const compressed = await sharp(imageBuffer)
        .jpeg({ quality: isPredictiveCapture ? 72 : 85 })
        .toBuffer()

      const base64 = compressed.toString('base64')

      return {
        buffer: compressed,
        base64,
        size: compressed.length
      }
    }

    // For larger images, resize and compress more aggressively
    let quality = isPredictiveCapture ? 70 : 80
    let width = metadata.width

    // Scale down if very large
    const maxWidth = isPredictiveCapture ? 960 : 1920
    if (width > maxWidth) {
      width = maxWidth
    }

    const compressed = await sharp(imageBuffer)
      .resize(width, null, { withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer()

    const base64 = compressed.toString('base64')

    console.log('Compressed large image:', {
      originalSize: `${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB`,
      compressedSize: `${(compressed.length / 1024 / 1024).toFixed(2)}MB`,
      resizedWidth: width,
      quality
    })

    return {
      buffer: compressed,
      base64,
      size: compressed.length
    }
  } catch (error) {
    console.error('Error compressing image:', error)
    throw new Error(`Failed to compress image: ${error.message}`)
  }
}

/**
 * Captures a screenshot and compresses it to JPEG format
 * @param {{captureMode?: string}} options - Capture metadata (manual|predictive|send)
 * @returns {Promise<{buffer: Buffer, base64: string, size: number}>}
 */
async function captureAndCompress(options = {}) {
  const screenshotBuffer = await captureScreen(options)
  const captureMode = typeof options.captureMode === 'string' ? options.captureMode : 'unknown'

  // Save PNG to disk in development mode for debugging (manual captures only)
  const isDevelopment = process.env.NODE_ENV !== 'production'
  if (isDevelopment && captureMode === 'manual') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `screenshot-${timestamp}.png`
      const screenshotsDir = path.join(process.cwd(), 'testing', 'screenshots')
      const filepath = path.join(screenshotsDir, filename)

      // Ensure directory exists
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true })
      }

      // Save the uncompressed PNG buffer to disk
      fs.writeFileSync(filepath, screenshotBuffer)
      console.log(`[DEV] Screenshot saved to: ${filepath}`)
    } catch (error) {
      console.error('[DEV] Failed to save screenshot to disk:', error.message)
      // Don't throw - saving to disk is optional
    }
  }

  // Compress PNG to JPEG for API transmission
  const compressed = await compressImage(screenshotBuffer, options)

  return compressed
}

module.exports = {
  captureScreen,
  compressImage,
  captureAndCompress
}
