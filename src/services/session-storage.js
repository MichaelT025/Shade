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

    this.sessionsDir = path.join(userDataPath, 'sessions')
    this.sessionAssetsRoot = path.join(this.sessionsDir, '_assets')
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

  sessionAssetsDirForId(id) {
    if (!id || typeof id !== 'string') {
      throw new Error('Session id is required')
    }

    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!safeId) {
      throw new Error('Invalid session id')
    }

    return path.join(this.sessionAssetsRoot, safeId)
  }

  screenshotDirForSession(id) {
    return path.join(this.sessionAssetsDirForId(id), 'screenshots')
  }

  async writeScreenshot(sessionId, messageId, base64) {
    const dir = this.screenshotDirForSession(sessionId)
    await fs.mkdir(dir, { recursive: true })

    const filePart = safePathPart(messageId) || generateId()
    const filename = `${filePart}.jpg`

    const filePath = path.join(dir, filename)
    const buffer = Buffer.from(base64, 'base64')

    await fs.writeFile(filePath, buffer)

    // Store path relative to the session assets root.
    return path.join('screenshots', filename)
  }

  async readScreenshotBase64(sessionId, screenshotPath) {
    const rel = safeText(screenshotPath)
    if (!rel) return ''
    if (rel.includes('..') || path.isAbsolute(rel)) return ''

    const fullPath = path.join(this.sessionAssetsDirForId(sessionId), rel)

    try {
      const data = await fs.readFile(fullPath)
      return data.toString('base64')
    } catch {
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

    const title = safeText(session?.title).trim() || this.generateTitle(messages)

    const normalizedSession = {
      id,
      title,
      createdAt,
      updatedAt,
      provider: safeText(session?.provider),
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
        const model = safeText(session.model)
        const isSaved = !!session.isSaved

        const messageCount = Array.isArray(session.messages) ? session.messages.length : 0

        sessions.push({ id, title, createdAt, updatedAt, provider, model, isSaved, messageCount })
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
      const assetsDir = this.sessionAssetsDirForId(id)
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
