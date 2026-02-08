export function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function safePathPart(value) {
  return (value || '').toString().replace(/[^a-zA-Z0-9_-]/g, '')
}

export function toIsoTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString()
  }

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return new Date().toISOString()
}

export function buildSessionPayload({ currentSessionId, provider, mode, model, messages }) {
  return {
    id: currentSessionId,
    title: '',
    createdAt: null,
    provider,
    mode,
    model,
    messages: messages.map(m => ({
      id: m.id,
      type: m.type,
      text: m.text,
      hasScreenshot: !!m.hasScreenshot,
      ...(typeof m.screenshotPath === 'string' && m.screenshotPath ? { screenshotPath: m.screenshotPath } : {}),
      ...(typeof m.screenshotBase64 === 'string' && m.screenshotBase64 ? { screenshotBase64: m.screenshotBase64 } : {}),
      timestamp: toIsoTimestamp(m.timestamp)
    }))
  }
}

export function prunePersistedScreenshotBase64(messages) {
  for (const m of messages) {
    if (m && typeof m.screenshotBase64 === 'string' && m.screenshotBase64 && typeof m.screenshotPath === 'string' && m.screenshotPath) {
      delete m.screenshotBase64
    }
  }
}

export function normalizeSessionMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) {
    return []
  }

  return rawMessages.map(m => ({
    id: typeof m.id === 'string' ? m.id : generateMessageId(),
    type: m.type === 'ai' ? 'ai' : 'user',
    text: typeof m.text === 'string' ? m.text : '',
    hasScreenshot: !!m.hasScreenshot,
    screenshotPath: typeof m.screenshotPath === 'string' ? m.screenshotPath : '',
    screenshotBase64: typeof m.screenshotBase64 === 'string' ? m.screenshotBase64 : '',
    timestamp: m.timestamp ? new Date(m.timestamp) : new Date()
  }))
}
