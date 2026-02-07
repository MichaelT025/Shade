export function formatTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function getDayLabel(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown'

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const atMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (isSameDay(atMidnight, today)) return 'Today'
  if (isSameDay(atMidnight, yesterday)) return 'Yesterday'

  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export function groupSessionsByDay(sessions) {
  const groups = new Map()

  for (const session of sessions) {
    const key = getDayLabel(session.updatedAt || session.createdAt)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(session)
  }

  return groups
}

export function normalizeProvidersMeta(providers) {
  if (!providers) return []
  if (!Array.isArray(providers) && typeof providers === 'object') {
    return Object.entries(providers).map(([id, meta]) => ({
      id,
      ...meta
    }))
  }
  return providers.map(p => ({
    id: p.id || p.providerId || p.name,
    ...p
  })).filter(p => p.id)
}

export function getProviderLabel(provider) {
  return provider?.label || provider?.displayName || provider?.name || provider?.id
}

export function extractModelsFromProviderMeta(providerMeta) {
  const models = providerMeta?.models
  if (!models) return []
  if (Array.isArray(models)) {
    return models.map(m => ({
      id: m.id || m.model || m.name,
      ...m
    })).filter(m => m.id)
  }
  if (typeof models === 'object') {
    return Object.entries(models).map(([id, meta]) => ({ id, ...meta }))
  }
  return []
}

export function normalizeSearchText(value) {
  const raw = (value || '').toString().toLowerCase().trim()
  const spaced = raw.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  return {
    raw,
    spaced,
    noSpace: spaced.replace(/\s+/g, '')
  }
}

export function scoreModelMatch(model, query) {
  const q = normalizeSearchText(query)
  if (!q.spaced) return { score: 0 }

  const idText = normalizeSearchText(model?.id)
  const nameText = normalizeSearchText(model?.name)

  const candidates = [idText, nameText]
    .filter(c => c && (c.spaced || c.noSpace))

  let best = null

  for (const c of candidates) {
    let score = null

    if (c.spaced === q.spaced) score = 1000
    else if (c.noSpace === q.noSpace && q.noSpace) score = 950
    else if (c.spaced.includes(q.spaced)) score = 800
    else if (c.noSpace.includes(q.noSpace) && q.noSpace.length >= 3) score = 780
    else {
      const qTokens = q.spaced.split(' ').filter(Boolean)
      const cTokens = new Set(c.spaced.split(' ').filter(Boolean))

      const matched = qTokens.filter(t => cTokens.has(t))
      if (matched.length === qTokens.length && qTokens.length) {
        score = 700 + matched.length * 10
      } else if (matched.length) {
        score = 500 + matched.length * 10
      }
    }

    if (score !== null && (best === null || score > best)) {
      best = score
    }
  }

  if (best === null) return null
  return { score: best }
}
