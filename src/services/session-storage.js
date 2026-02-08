const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')

function generateId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return crypto.randomBytes(16).toString('hex')
}

function normalizeIsoTimestamp(value) {
  if (!value) return new Date().toISOString()

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }

  return new Date().toISOString()
}

function safeText(value) {
  if (typeof value !== 'string') return ''
  return value
}

function safePathPart(value) {
  const raw = safeText(value)
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '')
  return cleaned
}

function normalizeSessionMessage(message) {
  const timestamp = normalizeIsoTimestamp(message?.timestamp)
  const type = message?.type === 'ai' ? 'ai' : 'user'
  const hasScreenshot = !!message?.hasScreenshot

  const screenshotPathRaw = hasScreenshot && type === 'user'
    ? safeText(message?.screenshotPath)
    : ''

  const screenshotPath = screenshotPathRaw && !screenshotPathRaw.includes('..') && !path.isAbsolute(screenshotPathRaw)
    ? screenshotPathRaw
    : ''

  return {
    id: safeText(message?.id) || generateId(),
    type,
    text: safeText(message?.text),
    hasScreenshot,
    screenshotPath: screenshotPath || undefined,
    timestamp
  }
}

class SessionStorage {
  constructor(userDataPath) {
    if (!userDataPath) {
      throw new Error('userDataPath is required for SessionStorage')
    }

    this.userDataPath = userDataPath
    this.dataDir = path.join(userDataPath, 'data')
    
    // Ensure data directory exists
    if (!require('fs').existsSync(this.dataDir)) {
      try {
        require('fs').mkdirSync(this.dataDir, { recursive: true })
      } catch (e) {
        console.error('Failed to create data directory:', e)
      }
    }

    this.sessionsDir = path.join(this.dataDir, 'sessions')
    this.screenshotsDir = path.join(this.dataDir, 'screenshots')
    this.sessionAssetsRoot = path.join(this.sessionsDir, '_assets') // Kept for legacy ref support if needed, but not used for new files

    // Perform migration if needed
    this.migrateDataStructure().catch(err => console.error('Data migration failed:', err))
  }

  async migrateDataStructure() {
    const oldSessionsDir = path.join(this.userDataPath, 'sessions')
    
    // If old sessions dir exists and new sessions dir is empty/doesn't exist
    try {
      const fsSync = require('fs')
      
      // Check if migration is needed (old dir exists)
      if (!fsSync.existsSync(oldSessionsDir)) return

      // Ensure new dirs exist
      await fs.mkdir(this.sessionsDir, { recursive: true })
      await fs.mkdir(this.screenshotsDir, { recursive: true })

      console.log('Migrating sessions to new data structure...')

      // 1. Move all .json session files
      const files = await fs.readdir(oldSessionsDir)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const oldPath = path.join(oldSessionsDir, file)
          const newPath = path.join(this.sessionsDir, file)
          try {
             if (!fsSync.existsSync(newPath)) {
               await fs.rename(oldPath, newPath)
             }
          } catch (e) {
            console.error(`Failed to move session file ${file}:`, e)
          }
        }
      }

      // 2. Move screenshots from _assets
      const oldAssetsDir = path.join(oldSessionsDir, '_assets')
      if (fsSync.existsSync(oldAssetsDir)) {
        const sessionAssetDirs = await fs.readdir(oldAssetsDir)
        for (const sessionId of sessionAssetDirs) {
          const sessionScreenshotsDir = path.join(oldAssetsDir, sessionId, 'screenshots')
          
          if (fsSync.existsSync(sessionScreenshotsDir)) {
            // Target dir: data/screenshots/<sessionId>
            const targetDir = path.join(this.screenshotsDir, sessionId)
            await fs.mkdir(targetDir, { recursive: true })

            const images = await fs.readdir(sessionScreenshotsDir)
            for (const img of images) {
              const oldImgPath = path.join(sessionScreenshotsDir, img)
              const newImgPath = path.join(targetDir, img)
              try {
                if (!fsSync.existsSync(newImgPath)) {
                  await fs.rename(oldImgPath, newImgPath)
                }
              } catch (e) {
                console.error(`Failed to move screenshot ${img}:`, e)
              }
            }
          }
        }
      }
      
      console.log('Migration completed.')
      
      // Optional: Remove old directory if empty? 
      // Safe to leave it for now to prevent data loss if something went wrong.
      // But we can try to cleanup if it's empty.
      
    } catch (error) {
      console.error('Error during data structure migration:', error)
    }
  }

  sessionPathForId(id) {
    if (!id || typeof id !== 'string') {
      throw new Error('Session id is required')
    }

    // Only allow simple filenames, no traversal.
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!safeId) {
      throw new Error('Invalid session id')
    }

    return path.join(this.sessionsDir, `${safeId}.json`)
  }

  // Updated to point to new flat structure: data/screenshots/<sessionId>
  screenshotDirForSession(id) {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '')
    return path.join(this.screenshotsDir, safeId)
  }

  async writeScreenshot(sessionId, messageId, base64) {
    const dir = this.screenshotDirForSession(sessionId)
    await fs.mkdir(dir, { recursive: true })

    const filePart = safePathPart(messageId) || generateId()
    const filename = `${filePart}.jpg`

    const filePath = path.join(dir, filename)
    const buffer = Buffer.from(base64, 'base64')

    await fs.writeFile(filePath, buffer)

    // Store simple filename or relative path. 
    // We'll store just the filename or "screenshots/filename" for compat?
    // Old format was "screenshots/filename.jpg" (relative to assets/<id>)
    // New structure is flat per session. 
    // Let's store "filename.jpg" and handle it in read.
    // BUT to keep compat with existing JSONs that might say "screenshots/foo.jpg",
    // we should normalize during read.
    // Let's store just the filename now to be cleaner.
    return filename
  }

  async readScreenshotBase64(sessionId, screenshotPath) {
    let rel = safeText(screenshotPath)
    if (!rel) return ''
    if (rel.includes('..') || path.isAbsolute(rel)) return ''

    // Normalize path separators for cross-platform compatibility
    rel = path.normalize(rel)

    // Normalize legacy paths: "screenshots/foo.jpg" -> "foo.jpg"
    if (rel.startsWith('screenshots' + path.sep)) {
        rel = path.basename(rel)
    }

    // Look in new location
    const fullPath = path.join(this.screenshotDirForSession(sessionId), rel)

    try {
      const data = await fs.readFile(fullPath)
      return data.toString('base64')
    } catch {
      // Fallback: try old location if migration failed or legacy path issues?
      // No, we rely on migration.
      return ''
    }
  }

  async ensureSessionsDir() {
    await fs.mkdir(this.sessionsDir, { recursive: true })
  }

  generateTitle(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return 'New Chat'
    }

    const firstUser = messages.find(m => m?.type === 'user' && typeof m.text === 'string' && m.text.trim().length > 0)
    const base = (firstUser?.text || messages[0]?.text || 'New Chat').trim()

    // Collapse whitespace/newlines and clamp length.
    const normalized = base.replace(/\s+/g, ' ')
    const maxLen = 64

    if (normalized.length <= maxLen) return normalized
    return normalized.slice(0, maxLen - 1).trimEnd() + '…'
  }

  async saveSession(session) {
    await this.ensureSessionsDir()

    const id = safeText(session?.id) || generateId()
    const filePath = this.sessionPathForId(id)

    const createdAt = normalizeIsoTimestamp(session?.createdAt)
    const updatedAt = new Date().toISOString()

    const rawMessages = Array.isArray(session?.messages)
      ? session.messages
      : []

    const messages = []

    for (const raw of rawMessages) {
      const normalized = normalizeSessionMessage(raw)

      if (normalized.type === 'user' && normalized.hasScreenshot) {
        const screenshotBase64 = safeText(raw?.screenshotBase64)
        if (screenshotBase64) {
          normalized.screenshotPath = await this.writeScreenshot(id, normalized.id, screenshotBase64)
        }
      }

      messages.push(normalized)
    }

    const requestedTitle = safeText(session?.title).trim()

    // Preserve existing title when saving an existing session unless a new
    // explicit title is provided. This prevents autosave calls from
    // overwriting AI/manual titles with fallback generated titles.
    let existingTitle = ''
    if (!requestedTitle && safeText(session?.id)) {
      try {
        const existingRaw = await fs.readFile(filePath, 'utf8')
        const existingSession = JSON.parse(existingRaw)
        existingTitle = safeText(existingSession?.title).trim()
      } catch {
        // Ignore missing/corrupt existing files and fall back to generated title.
      }
    }

    const title = requestedTitle || existingTitle || this.generateTitle(messages)

    const normalizedSession = {
      id,
      title,
      createdAt,
      updatedAt,
      provider: safeText(session?.provider),
      mode: safeText(session?.mode),
      model: safeText(session?.model),
      isSaved: !!session?.isSaved,
      messages
    }

    await fs.writeFile(filePath, JSON.stringify(normalizedSession, null, 2), 'utf8')

    return {
      id: normalizedSession.id,
      title: normalizedSession.title,
      createdAt: normalizedSession.createdAt,
      updatedAt: normalizedSession.updatedAt,
      provider: normalizedSession.provider,
      mode: normalizedSession.mode,
      model: normalizedSession.model,
      isSaved: normalizedSession.isSaved,
      messageCount: normalizedSession.messages.length
    }
  }

  async loadSession(id) {
    await this.ensureSessionsDir()

    const filePath = this.sessionPathForId(id)
    const data = await fs.readFile(filePath, 'utf8')
    const session = JSON.parse(data)

    // Minimal normalization on read.
    if (!session || typeof session !== 'object') {
      throw new Error('Invalid session file')
    }

    return {
      ...session,
      id: safeText(session.id) || id,
      title: safeText(session.title) || 'New Chat',
      createdAt: normalizeIsoTimestamp(session.createdAt),
      updatedAt: normalizeIsoTimestamp(session.updatedAt),
      provider: safeText(session.provider),
      mode: safeText(session.mode),
      model: safeText(session.model),
      isSaved: !!session.isSaved,
      messages: Array.isArray(session.messages) ? session.messages.map(normalizeSessionMessage) : []
    }
  }

  async getAllSessions() {
    await this.ensureSessionsDir()

    const files = await fs.readdir(this.sessionsDir)
    const sessionFiles = files.filter(f => f.endsWith('.json'))

    const sessions = []

    for (const file of sessionFiles) {
      try {
        const filePath = path.join(this.sessionsDir, file)
        const data = await fs.readFile(filePath, 'utf8')
        const session = JSON.parse(data)

        if (!session || typeof session !== 'object') continue

        const id = safeText(session.id) || file.replace(/\.json$/, '')
        const title = safeText(session.title) || 'New Chat'
        const createdAt = normalizeIsoTimestamp(session.createdAt)
        const updatedAt = normalizeIsoTimestamp(session.updatedAt)

        const provider = safeText(session.provider)
        const mode = safeText(session.mode)
        const model = safeText(session.model)
        const isSaved = !!session.isSaved

        const messageCount = Array.isArray(session.messages) ? session.messages.length : 0

        sessions.push({ id, title, createdAt, updatedAt, provider, mode, model, isSaved, messageCount })
      } catch (error) {
        // Skip corrupt session file.
        console.error('Failed to read session file:', file, error)
      }
    }

    sessions.sort((a, b) => {
      const aTime = new Date(a.updatedAt).getTime()
      const bTime = new Date(b.updatedAt).getTime()
      return bTime - aTime
    })

    return sessions
  }

  async deleteSession(id) {
    await this.ensureSessionsDir()

    const filePath = this.sessionPathForId(id)
    await fs.rm(filePath, { force: true })

    try {
      // Delete the session's screenshot folder
      const assetsDir = this.screenshotDirForSession(id)
      await fs.rm(assetsDir, { recursive: true, force: true })
    } catch {
      // ignore
    }

    return true
  }

  async renameSession(id, newTitle) {
    // Load session to verify existence and get content
    const session = await this.loadSession(id)
    if (!session) {
      throw new Error('Session not found')
    }

    // Update title
    session.title = safeText(newTitle).trim() || 'New Chat'
    
    // Save updated session
    return this.saveSession(session)
  }

  async toggleSessionSaved(id) {
    const session = await this.loadSession(id)
    if (!session) throw new Error('Session not found')

    session.isSaved = !session.isSaved
    return this.saveSession(session)
  }

  async setSessionSaved(id, isSaved) {
    const session = await this.loadSession(id)
    if (!session) throw new Error('Session not found')
    
    session.isSaved = !!isSaved
    return this.saveSession(session)
  }

  async searchSessions(query) {
    const all = await this.getAllSessions()
    const q = safeText(query).trim().toLowerCase()

    if (!q) return all

    return all.filter(s => (s.title || '').toLowerCase().includes(q))
  }

  async cleanupOldSessions() {
    await this.ensureSessionsDir()

    const sessions = await this.getAllSessions()
    const now = Date.now()
    const maxAgeMs = 30 * 24 * 60 * 60 * 1000

    const toDelete = sessions.filter(s => {
      // Never delete sessions that the user has explicitly saved.
      if (s.isSaved) return false

      const updated = new Date(s.updatedAt).getTime()
      const created = new Date(s.createdAt).getTime()
      const reference = Number.isFinite(updated) ? updated : created
      if (!Number.isFinite(reference)) return false
      return now - reference > maxAgeMs
    })

    for (const session of toDelete) {
      try {
        await this.deleteSession(session.id)
      } catch (error) {
        console.error('Failed to delete old session:', session.id, error)
      }
    }

    return { deleted: toDelete.length }
  }
}

module.exports = SessionStorage
