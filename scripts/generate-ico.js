const sharp = require('sharp')
const toIco = require('to-ico')
const fs = require('fs')
const path = require('path')

async function generateIco() {
  const inputPath = path.join(__dirname, '../build/appicon.png')
  const outputPath = path.join(__dirname, '../build/icon.ico')

  console.log('Generating icon.ico from appicon.png...')

  try {
    // First, finding the bounding box of visible pixels (alpha > 10)
    console.log('  Analyzing image bounds...')
    const original = sharp(inputPath)
    const { data, info } = await original.ensureAlpha().raw().toBuffer({ resolveWithObject: true })

    let minX = info.width
    let maxX = 0
    let minY = info.height
    let maxY = 0
    
    // Scan for visible pixels
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const idx = (y * info.width + x) * 4
        const alpha = data[idx + 3]
        if (alpha > 100) { // Threshold for "visible" - increased to 100 to crop faint shadows/glow and maximize core logo size
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    // Fallback if image is empty or full (sanity check)
    if (minX > maxX) {
      minX = 0; maxX = info.width - 1; minY = 0; maxY = info.height - 1
    }

    const width = maxX - minX + 1
    const height = maxY - minY + 1
    
    console.log(`  Found content bounds: ${width}x${height} at ${minX},${minY}`)

    // Extract the content
    const croppedBuffer = await sharp(inputPath)
      .extract({ left: minX, top: minY, width: width, height: height })
      .toBuffer()

    // Create resized PNGs for ICO
    // We use the cropped content and resize it to fit FULLY into the target squares
    const sizes = [16, 32, 48, 256]
    const buffers = []

    for (const size of sizes) {
      console.log(`  Creating ${size}x${size} version...`)
      const buffer = await sharp(croppedBuffer)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer()

      buffers.push(buffer)
    }


    // Convert to ICO
    console.log('  Converting to ICO format...')
    const icoBuffer = await toIco(buffers)

    // Write the ICO file
    fs.writeFileSync(outputPath, icoBuffer)

    console.log('✓ Successfully generated icon.ico')
    console.log(`  Output: ${outputPath}`)
  } catch (error) {
    console.error('Error generating icon:', error)
    process.exit(1)
  }
}

generateIco()
