import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'

// Import SessionStorage
const SessionStorage = (await import('../session-storage.js')).default

describe('SessionStorage', () => {
  let sessionStorage
  let testDir

  beforeEach(async () => {
    // Set up test directory
    testDir = path.join('/tmp/shade-sessions-test')

    // Clean up and create fresh directory
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch (error) {
      // Ignore if doesn't exist
    }

    await fs.mkdir(testDir, { recursive: true })

    // Create fresh instance with test directory
    sessionStorage = new SessionStorage(testDir)
  })

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch (error) {
      // Ignore errors
    }
  })

  describe('Initialization', () => {
    test('should create SessionStorage instance', () => {
      expect(sessionStorage).toBeDefined()
      // Service adds 'data/sessions' to userDataPath
      expect(sessionStorage.sessionsDir).toBe(path.join(testDir, 'data', 'sessions'))
    })

    test('should throw error without userDataPath', () => {
      expect(() => {
        new SessionStorage()
      }).toThrow('userDataPath is required')
    })
  })

  describe('Session Saving', () => {
    test('should save a new session', async () => {
      const session = {
        messages: [
          { type: 'user', text: 'Hello', hasScreenshot: false },
          { type: 'ai', text: 'Hi there!', hasScreenshot: false }
        ],
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp'
      }

      const result = await sessionStorage.saveSession(session)

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.title).toBeDefined()
      expect(result.messageCount).toBe(2)
      expect(result.provider).toBe('gemini')
      expect(result.model).toBe('gemini-2.0-flash-exp')
    })

    test('should auto-generate session ID', async () => {
      const session = {
        messages: [{ type: 'user', text: 'Test' }]
      }

      const result = await sessionStorage.saveSession(session)

      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(result.id.length).toBeGreaterThan(0)
    })

    test('should use existing session ID', async () => {
      const session = {
        id: 'my-custom-id',
        messages: [{ type: 'user', text: 'Test' }]
      }

      const result = await sessionStorage.saveSession(session)

      expect(result.id).toBe('my-custom-id')
    })

    test('should auto-generate title from first user message', async () => {
      const session = {
        messages: [
          { type: 'user', text: 'What is the capital of France?' },
          { type: 'ai', text: 'Paris' }
        ]
      }

      const result = await sessionStorage.saveSession(session)

      expect(result.title).toBe('What is the capital of France?')
    })

    test('should use custom title if provided', async () => {
      const session = {
        title: 'My Custom Title',
        messages: [{ type: 'user', text: 'Test' }]
      }

      const result = await sessionStorage.saveSession(session)

      expect(result.title).toBe('My Custom Title')
    })

    test('should preserve existing title on update when title is omitted', async () => {
      const created = await sessionStorage.saveSession({
        title: 'AI Generated Title',
        messages: [
          { type: 'user', text: 'First message' },
          { type: 'ai', text: 'First reply' }
        ]
      })

      const updated = await sessionStorage.saveSession({
        id: created.id,
        messages: [
          { type: 'user', text: 'Completely different prompt text' },
          { type: 'ai', text: 'Another reply' }
        ]
      })

      expect(updated.title).toBe('AI Generated Title')
    })

    test('should truncate long titles', async () => {
      const longMessage = 'A'.repeat(100)
      const session = {
        messages: [{ type: 'user', text: longMessage }]
      }

      const result = await sessionStorage.saveSession(session)

      expect(result.title.length).toBeLessThanOrEqual(65)
      expect(result.title).toContain('…')
    })

    test('should normalize whitespace in title', async () => {
      const session = {
        messages: [{ type: 'user', text: 'Hello\n\n   world\t\ttest' }]
      }

      const result = await sessionStorage.saveSession(session)

      expect(result.title).toBe('Hello world test')
    })

    test('should save session with screenshots', async () => {
      const session = {
        messages: [
          { type: 'user', text: 'Look at this', hasScreenshot: true, screenshotBase64: 'base64data' },
          { type: 'ai', text: 'I see it', hasScreenshot: false }
        ]
      }

      const result = await sessionStorage.saveSession(session)

      const loaded = await sessionStorage.loadSession(result.id)
      expect(loaded.messages[0].hasScreenshot).toBe(true)
      expect(loaded.messages[1].hasScreenshot).toBe(false)
      expect(loaded.messages[0].screenshotPath).toBeDefined()
    })

    test('should create sessions directory if not exists', async () => {
      // Remove sessions directory
      await fs.rm(sessionStorage.sessionsDir, { recursive: true, force: true })

      const session = {
        messages: [{ type: 'user', text: 'Test' }]
      }

      await sessionStorage.saveSession(session)

      // Verify directory was created
      const stats = await fs.stat(sessionStorage.sessionsDir)
      expect(stats.isDirectory()).toBe(true)
    })
  })

  describe('Session Loading', () => {
    test('should load saved session', async () => {
      const session = {
        id: 'load-test',
        messages: [
          { type: 'user', text: 'Test message' },
          { type: 'ai', text: 'Test response' }
        ],
        provider: 'openai',
        model: 'gpt-4o'
      }

      await sessionStorage.saveSession(session)
      const loaded = await sessionStorage.loadSession('load-test')

      expect(loaded.id).toBe('load-test')
      expect(loaded.messages.length).toBe(2)
      expect(loaded.messages[0].text).toBe('Test message')
      expect(loaded.provider).toBe('openai')
      expect(loaded.model).toBe('gpt-4o')
    })

    test('should throw error for non-existent session', async () => {
      await expect(
        sessionStorage.loadSession('non-existent')
      ).rejects.toThrow()
    })

    test('should normalize loaded session data', async () => {
      const session = {
        messages: [{ type: 'user', text: 'Test' }]
      }

      const saved = await sessionStorage.saveSession(session)
      const loaded = await sessionStorage.loadSession(saved.id)

      expect(loaded.id).toBeDefined()
      expect(loaded.title).toBeDefined()
      expect(loaded.createdAt).toBeDefined()
      expect(loaded.updatedAt).toBeDefined()
      expect(Array.isArray(loaded.messages)).toBe(true)
    })

    test('should throw invalid session error for malformed json session file', async () => {
      const filePath = path.join(sessionStorage.sessionsDir, 'broken.json')
      await fs.mkdir(sessionStorage.sessionsDir, { recursive: true })
      await fs.writeFile(filePath, '{bad-json', 'utf8')

      await expect(sessionStorage.loadSession('broken')).rejects.toThrow('Invalid session file')
    })
  })

  describe('Listing Sessions', () => {
    test('should return empty array when no sessions exist', async () => {
      const sessions = await sessionStorage.getAllSessions()

      expect(Array.isArray(sessions)).toBe(true)
      expect(sessions.length).toBe(0)
    })

    test('should list all saved sessions', async () => {
      await sessionStorage.saveSession({ messages: [{ type: 'user', text: 'Test 1' }] })
      await sessionStorage.saveSession({ messages: [{ type: 'user', text: 'Test 2' }] })
      await sessionStorage.saveSession({ messages: [{ type: 'user', text: 'Test 3' }] })

      const sessions = await sessionStorage.getAllSessions()

      expect(sessions.length).toBe(3)
    })

    test('should sort sessions by updatedAt (newest first)', async () => {
      const session1 = await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'First' }]
      })

      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10))

      const session2 = await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'Second' }]
      })

      const sessions = await sessionStorage.getAllSessions()

      expect(sessions[0].id).toBe(session2.id)
      expect(sessions[1].id).toBe(session1.id)
    })

    test('should include session metadata', async () => {
      await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'Test' }],
        provider: 'anthropic',
        model: 'claude-sonnet-4-5'
      })

      const sessions = await sessionStorage.getAllSessions()

      expect(sessions[0]).toHaveProperty('id')
      expect(sessions[0]).toHaveProperty('title')
      expect(sessions[0]).toHaveProperty('createdAt')
      expect(sessions[0]).toHaveProperty('updatedAt')
      expect(sessions[0]).toHaveProperty('provider')
      expect(sessions[0]).toHaveProperty('model')
      expect(sessions[0]).toHaveProperty('messageCount')
      expect(sessions[0].messageCount).toBe(1)
    })

    test('should skip corrupt session files', async () => {
      // Create a valid session
      await sessionStorage.saveSession({ messages: [{ type: 'user', text: 'Valid' }] })

      // Create a corrupt session file
      await fs.writeFile(
        path.join(sessionStorage.sessionsDir, 'corrupt.json'),
        'invalid json {[}',
        'utf8'
      )

      const sessions = await sessionStorage.getAllSessions()

      // Should only return the valid session
      expect(sessions.length).toBe(1)
    })
  })

  describe('Session Deletion', () => {
    test('should delete a session', async () => {
      const result = await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'Delete me' }]
      })

      await sessionStorage.deleteSession(result.id)

      await expect(
        sessionStorage.loadSession(result.id)
      ).rejects.toThrow()
    })

    test('should return true after successful deletion', async () => {
      const result = await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'Test' }]
      })

      const deleted = await sessionStorage.deleteSession(result.id)
      expect(deleted).toBe(true)
    })

    test('should not throw error when deleting non-existent session', async () => {
      const result = await sessionStorage.deleteSession('non-existent')
      expect(result).toBe(true)
    })
  })

  describe('Session Renaming', () => {
    test('should rename a session', async () => {
      const result = await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'Test' }]
      })

      await sessionStorage.renameSession(result.id, 'New Title')

      const loaded = await sessionStorage.loadSession(result.id)
      expect(loaded.title).toBe('New Title')
    })

    test('should throw error when renaming non-existent session', async () => {
      await expect(
        sessionStorage.renameSession('non-existent', 'New Title')
      ).rejects.toThrow()
    })

    test('should trim and normalize new title', async () => {
      const result = await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'Test' }]
      })

      await sessionStorage.renameSession(result.id, '  Trimmed Title  ')

      const loaded = await sessionStorage.loadSession(result.id)
      expect(loaded.title).toBe('Trimmed Title')
    })

    test('should fallback to "New Chat" for empty title', async () => {
      const result = await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'Test' }]
      })

      await sessionStorage.renameSession(result.id, '   ')

      const loaded = await sessionStorage.loadSession(result.id)
      expect(loaded.title).toBe('New Chat')
    })
  })

  describe('Session Saved State', () => {
    test('should toggle session saved state', async () => {
      const result = await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'Test' }],
        isSaved: false
      })

      await sessionStorage.toggleSessionSaved(result.id)
      let loaded = await sessionStorage.loadSession(result.id)
      expect(loaded.isSaved).toBe(true)

      await sessionStorage.toggleSessionSaved(result.id)
      loaded = await sessionStorage.loadSession(result.id)
      expect(loaded.isSaved).toBe(false)
    })

    test('should set session saved state', async () => {
      const result = await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'Test' }]
      })

      await sessionStorage.setSessionSaved(result.id, true)
      let loaded = await sessionStorage.loadSession(result.id)
      expect(loaded.isSaved).toBe(true)

      await sessionStorage.setSessionSaved(result.id, false)
      loaded = await sessionStorage.loadSession(result.id)
      expect(loaded.isSaved).toBe(false)
    })
  })

  describe('Session Search', () => {
    test('should search sessions by title', async () => {
      await sessionStorage.saveSession({
        title: 'JavaScript Tutorial',
        messages: [{ type: 'user', text: 'Test' }]
      })
      await sessionStorage.saveSession({
        title: 'Python Guide',
        messages: [{ type: 'user', text: 'Test' }]
      })
      await sessionStorage.saveSession({
        title: 'JavaScript Advanced',
        messages: [{ type: 'user', text: 'Test' }]
      })

      const results = await sessionStorage.searchSessions('JavaScript')

      expect(results.length).toBe(2)
      expect(results.every(s => s.title.includes('JavaScript'))).toBe(true)
    })

    test('should be case-insensitive', async () => {
      await sessionStorage.saveSession({
        title: 'Test Session',
        messages: [{ type: 'user', text: 'Test' }]
      })

      const results = await sessionStorage.searchSessions('test')
      expect(results.length).toBe(1)
    })

    test('should return all sessions for empty query', async () => {
      await sessionStorage.saveSession({ messages: [{ type: 'user', text: 'Test 1' }] })
      await sessionStorage.saveSession({ messages: [{ type: 'user', text: 'Test 2' }] })

      const results = await sessionStorage.searchSessions('')
      expect(results.length).toBe(2)
    })
  })

  describe('Session Cleanup', () => {
    test('should delete sessions older than 30 days', async () => {
      // Create old session by directly writing to file with old timestamp
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 35) // 35 days ago

      const oldSession = {
        id: 'old-session-test',
        title: 'Old session',
        createdAt: oldDate.toISOString(),
        updatedAt: oldDate.toISOString(),
        provider: 'gemini',
        model: 'gemini-2.0-flash-exp',
        isSaved: false,
        messages: [{ id: '1', type: 'user', text: 'Old', hasScreenshot: false, timestamp: oldDate.toISOString() }]
      }

      // Directly write old session file
      await sessionStorage.ensureSessionsDir()
      const fs = await import('fs/promises')
      const path = await import('path')
      await fs.writeFile(
        path.join(sessionStorage.sessionsDir, 'old-session-test.json'),
        JSON.stringify(oldSession, null, 2),
        'utf8'
      )

      // Create new session
      await sessionStorage.saveSession({
        messages: [{ type: 'user', text: 'New session' }]
      })

      const cleanup = await sessionStorage.cleanupOldSessions()

      expect(cleanup.deleted).toBe(1)

      const remaining = await sessionStorage.getAllSessions()
      expect(remaining.length).toBe(1)
      expect(remaining[0].title).toContain('New session')
    })

    test('should not delete sessions newer than 30 days', async () => {
      await sessionStorage.saveSession({ messages: [{ type: 'user', text: 'Recent' }] })
      await sessionStorage.saveSession({ messages: [{ type: 'user', text: 'Also recent' }] })

      const cleanup = await sessionStorage.cleanupOldSessions()

      expect(cleanup.deleted).toBe(0)

      const sessions = await sessionStorage.getAllSessions()
      expect(sessions.length).toBe(2)
    })
  })

  describe('Security', () => {
    test('should sanitize session ID to prevent path traversal', async () => {
      const maliciousId = '../../../etc/passwd'
      const session = {
        id: maliciousId,
        messages: [{ type: 'user', text: 'Test' }]
      }

      const result = await sessionStorage.saveSession(session)

      // Session is saved, but ID is stored as-is
      // Sanitization happens when converting to file path
      const sessionPath = sessionStorage.sessionPathForId(result.id)

      // File path should be sanitized (no traversal characters)
      expect(sessionPath).not.toContain('../')
      expect(sessionPath).toContain(sessionStorage.sessionsDir)
    })

    test('should reject invalid session IDs', () => {
      expect(() => {
        sessionStorage.sessionPathForId('')
      }).toThrow('Session id is required')
    })

    test('should sanitize invalid characters from session ID', () => {
      const result = sessionStorage.sessionPathForId('test/../../../etc/passwd')
      // Should only contain safe characters
      expect(result).toContain(sessionStorage.sessionsDir)
      expect(result).toContain('testetcpasswd.json')
    })
  })
})
