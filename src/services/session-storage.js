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

function normalizeSessionMessage(message) {
  const timestamp = normalizeIsoTimestamp(message?.timestamp)
  const type = message?.type === 'ai' ? 'ai' : 'user'

  return {
    id: safeText(message?.id) || generateId(),
    type,
    text: safeText(message?.text),
    hasScreenshot: !!message?.hasScreenshot,
    timestamp
  }
}

class SessionStorage {
  constructor(userDataPath) {
    if (!userDataPath) {
      throw new Error('userDataPath is required for SessionStorage')
    }

    this.sessionsDir = path.join(userDataPath, 'sessions')
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

    const messages = Array.isArray(session?.messages)
      ? session.messages.map(normalizeSessionMessage)
      : []

    const title = safeText(session?.title).trim() || this.generateTitle(messages)

    const normalizedSession = {
      id,
      title,
      createdAt,
      updatedAt,
      provider: safeText(session?.provider),
      model: safeText(session?.model),
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

        const messageCount = Array.isArray(session.messages) ? session.messages.length : 0

        sessions.push({ id, title, createdAt, updatedAt, provider, model, messageCount })
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
    return true
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
