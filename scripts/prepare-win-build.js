const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const winUnpackedDir = path.join(projectRoot, 'dist', 'win-unpacked')

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function tryStopRunningShade() {
  if (process.platform !== 'win32') {
    return
  }

  try {
    execSync('taskkill /F /T /IM Shade.exe', { stdio: 'ignore' })
    console.log('Stopped running Shade.exe process to release dist/win-unpacked locks.')
  } catch {
    // It's okay if Shade.exe is not running.
  }
}

async function removeDirWithRetries(dirPath, retries = 6, delayMs = 400) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await fs.promises.rm(dirPath, { recursive: true, force: true })
      return
    } catch (error) {
      const isRetryable = ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)

      if (!isRetryable || attempt === retries) {
        throw error
      }

      const waitMs = delayMs * attempt
      console.warn(
        `Retrying cleanup of ${dirPath} after ${error.code} (attempt ${attempt}/${retries})...`
      )
      await sleep(waitMs)
    }
  }
}

async function main() {
  if (!fs.existsSync(winUnpackedDir)) {
    return
  }

  tryStopRunningShade()

  try {
    await removeDirWithRetries(winUnpackedDir)
    console.log('Cleaned dist/win-unpacked before packaging.')
  } catch (error) {
    console.error(`Failed to clean ${winUnpackedDir}:`, error.message)
    console.error('Close any running Shade app instance and retry the build.')
    process.exit(1)
  }
}

main()
