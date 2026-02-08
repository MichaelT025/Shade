const fs = require('fs')
const path = require('path')

function buildTempPath(targetPath) {
  const dir = path.dirname(targetPath)
  const base = path.basename(targetPath)
  return path.join(dir, `${base}.tmp-${process.pid}-${Date.now()}`)
}

function writeFileAtomicSync(targetPath, data, encoding = 'utf8') {
  const tempPath = buildTempPath(targetPath)

  try {
    fs.writeFileSync(tempPath, data, encoding)
    fs.renameSync(tempPath, targetPath)
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }
    } catch {
      // ignore cleanup errors
    }
    throw error
  }
}

module.exports = {
  writeFileAtomicSync
}
