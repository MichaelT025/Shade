const sharp = require('sharp')
const { desktopCapturer } = require('electron')
const fs = require('fs')
const path = require('path')

/**
 * Captures a screenshot of the primary display using Electron's desktopCapturer
 * Windows with setContentProtection(true) are automatically excluded from capture
 * @returns {Promise<Buffer>} Screenshot as a buffer
 */
async function captureScreen() {
  try {
    // Get available sources (screens)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: 1920 * 2, // Support high-DPI displays
        height: 1080 * 2
      }
    })

    if (sources.length === 0) {
      throw new Error('No screen sources available')
    }

    // Use the first screen (primary display)
    const primaryScreen = sources[0]

    // Get the thumbnail as a NativeImage
    const thumbnail = primaryScreen.thumbnail

    // Convert NativeImage to PNG buffer
    const pngBuffer = thumbnail.toPNG()

    console.log('Screenshot captured successfully using desktopCapturer')
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
async function compressImage(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata()

    // Target max size: 5MB
    const MAX_SIZE = 5 * 1024 * 1024

    // If image is already small enough, just convert to JPEG with quality 85
    if (imageBuffer.length < MAX_SIZE) {
      const compressed = await sharp(imageBuffer)
        .jpeg({ quality: 85 })
        .toBuffer()

      const base64 = compressed.toString('base64')

      return {
        buffer: compressed,
        base64,
        size: compressed.length
      }
    }

    // For larger images, resize and compress more aggressively
    let quality = 80
    let width = metadata.width

    // Scale down if very large
    if (width > 1920) {
      width = 1920
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
 * @returns {Promise<{buffer: Buffer, base64: string, size: number}>}
 */
async function captureAndCompress() {
  const screenshot = await captureScreen()

  // Save PNG to disk in development mode for debugging
  const isDevelopment = process.env.NODE_ENV !== 'production'
  if (isDevelopment) {
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
      fs.writeFileSync(filepath, screenshot)
      console.log(`[DEV] Screenshot saved to: ${filepath}`)
    } catch (error) {
      console.error('[DEV] Failed to save screenshot to disk:', error.message)
      // Don't throw - saving to disk is optional
    }
  }

  // Compress PNG to JPEG for API transmission
  const compressed = await compressImage(screenshot)

  return compressed
}

module.exports = {
  captureScreen,
  compressImage,
  captureAndCompress
}
