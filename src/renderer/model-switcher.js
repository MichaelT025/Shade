import { initIcons, insertIcon } from './assets/icons/icons.js'

function normalizeProvidersMeta(providers) {
  if (!providers) return []
  if (!Array.isArray(providers) && typeof providers === 'object') {
    return Object.entries(providers).map(([id, meta]) => ({ id, ...meta }))
  }
  return providers
    .map(p => ({ id: p.id || p.providerId || p.name, ...p }))
    .filter(p => p.id)
}

function getProviderLabel(provider) {
  return provider?.label || provider?.displayName || provider?.name || provider?.id || ''
}

function extractModelsFromProviderMeta(providerMeta) {
  const models = providerMeta?.models
  if (!models) return []
  if (Array.isArray(models)) {
    return models
      .map(m => ({ id: m.id || m.model || m.name, ...m }))
      .filter(m => m.id)
  }
  if (typeof models === 'object') {
    return Object.entries(models).map(([id, meta]) => ({ id, ...meta }))
  }
  return []
}

function normalizeSearchText(value) {
  const raw = (value || '').toString().toLowerCase().trim()
  const spaced = raw.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  return {
    raw,
    spaced,
    noSpace: spaced.replace(/\s+/g, '')
  }
}

function scoreModelMatch(model, query) {
  const q = normalizeSearchText(query)
  if (!q.spaced) return { score: 0 }

  const idText = normalizeSearchText(model?.id)
  const nameText = normalizeSearchText(model?.name)
  const candidates = [idText, nameText].filter(Boolean)

  let best = null
  for (const c of candidates) {
    let score = null

    if (c.spaced === q.spaced) score = 1000
    else if (c.noSpace === q.noSpace && q.noSpace) score = 950
    else if (c.spaced.includes(q.spaced)) score = 800
    else if (c.noSpace.includes(q.noSpace) && q.noSpace.length >= 3) score = 780

    if (score !== null && (best === null || score > best)) best = score
  }

  if (best === null) return null
  return { score: best }
}

const els = {
  providerSelect: document.getElementById('provider-select'),
  modeNote: document.getElementById('mode-note'),
  keyNote: document.getElementById('key-note'),
  search: document.getElementById('search'),
  list: document.getElementById('list'),
  status: document.getElementById('status'),
  refresh: document.getElementById('refresh'),
  close: document.getElementById('close')
}

let state = {
  providerId: '',
  providerLabel: '',
  currentModelId: '',
  allProviders: [],
  allModels: [],
  filteredModels: [],
  highlightedIndex: -1,
  isSaving: false,
  isLoading: false
}

function setStatus(text) {
  if (els.status) els.status.textContent = text || ''
}

function setNote(el, text) {
  if (!el) return
  const has = !!(text || '').trim()
  el.textContent = text || ''
  el.classList.toggle('is-hidden', !has)
}

function clampIndex(idx, len) {
  if (!Number.isFinite(idx) || len <= 0) return -1
  return Math.max(0, Math.min(len - 1, idx))
}

function ensureHighlightVisible() {
  if (!els.list) return
  const item = els.list.querySelector(`[data-index="${state.highlightedIndex}"]`)
  if (item) item.scrollIntoView({ block: 'nearest' })
}

function renderList() {
  if (!els.list) return

  if (!state.filteredModels.length) {
    els.list.innerHTML = '<div class="note empty-state">No models found matching your search.</div>'
    return
  }

  els.list.innerHTML = state.filteredModels
    .map((m, idx) => {
      const isCurrent = m.id === state.currentModelId
      const isHighlighted = idx === state.highlightedIndex
      return `
        <div class="model-item ${isCurrent ? 'active' : ''} ${isHighlighted ? 'highlighted' : ''}" role="option" aria-selected="${isCurrent}" data-model-id="${m.id}" data-index="${idx}">
          <div class="item-id" title="${m.id}">${m.id}</div>
          ${isCurrent ? '<span class="badge-active">Active</span>' : ''}
        </div>
      `
    })
    .join('')
}

function applyFilter(query) {
  const q = (query || '').trim()

  let filtered
  if (!q) {
    filtered = state.allModels.slice()
  } else {
    filtered = state.allModels
      .map(m => ({ model: m, match: scoreModelMatch(m, q) }))
      .filter(x => x.match)
      .sort((a, b) => {
        if (b.match.score !== a.match.score) return b.match.score - a.match.score
        return (a.model.id || '').localeCompare(b.model.id || '')
      })
      .map(x => x.model)
  }

  if (state.currentModelId) {
    const idx = filtered.findIndex(m => m.id === state.currentModelId)
    if (idx > 0) {
      const [sel] = filtered.splice(idx, 1)
      filtered = [sel, ...filtered]
    }
  }

  state.filteredModels = filtered
  state.highlightedIndex = clampIndex(state.highlightedIndex, state.filteredModels.length)

  // Default highlight to current model or first item.
  if (state.highlightedIndex === -1 && state.filteredModels.length) {
    const currentIndex = state.filteredModels.findIndex(m => m.id === state.currentModelId)
    state.highlightedIndex = currentIndex >= 0 ? currentIndex : 0
  }

  renderList()
  ensureHighlightVisible()
}

async function refreshModelsIfNeeded({ force = false } = {}) {
  if (!state.providerId) return

  setStatus(force ? 'Refreshing models…' : 'Checking models…')

  let shouldRefresh = force

  try {
    const staleResult = await window.electronAPI.checkModelCacheStale(state.providerId)
    if (staleResult?.success && staleResult.isStale) {
      shouldRefresh = true
    }
  } catch {
    // ignore staleness check failures
  }

  if (!shouldRefresh) {
    setStatus('')
    return
  }

  const refreshed = await window.electronAPI.refreshModels(state.providerId)
  if (!refreshed?.success) {
    setStatus(refreshed?.error || 'Could not refresh models.')
    return
  }

  setStatus('')
}

async function loadProviderState() {
  const activeProviderResult = await window.electronAPI.getActiveProvider()
  const providerId = activeProviderResult?.success ? activeProviderResult.provider : ''
  state.providerId = providerId

  const allProvidersResult = await window.electronAPI.getAllProvidersMeta()
  const providers = normalizeProvidersMeta(allProvidersResult?.success ? allProvidersResult.providers : null)
  state.allProviders = providers

  // Populate provider dropdown
  if (els.providerSelect) {
    els.providerSelect.innerHTML = providers.map(p => {
      const label = getProviderLabel(p)
      const isSelected = p.id === providerId
      return `<option value="${p.id}" ${isSelected ? 'selected' : ''}>${label}</option>`
    }).join('')
  }

  const providerMeta = providers.find(p => p.id === providerId)
  state.providerLabel = getProviderLabel(providerMeta) || providerId

  const providerConfigResult = await window.electronAPI.getProviderConfig(providerId)
  const providerConfig = providerConfigResult?.success ? (providerConfigResult.config || {}) : {}
  state.currentModelId = providerConfig.model || ''

  const models = extractModelsFromProviderMeta(providerMeta)
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''))

  state.allModels = models

  // Mode override note (initial scope: changes Configuration only)
  try {
    const [modesResult, activeModeResult] = await Promise.all([
      window.electronAPI.getModes(),
      window.electronAPI.getActiveMode()
    ])

    const modes = modesResult?.success ? (modesResult.modes || []) : (modesResult?.modes || [])
    const activeModeId = activeModeResult?.success ? activeModeResult.modeId : activeModeResult?.modeId
    const activeMode = modes.find(m => m.id === activeModeId)

    if (activeMode?.overrideProviderModel) {
      setNote(els.modeNote, 'Mode override is enabled; switching here changes Configuration only.')
    } else {
      setNote(els.modeNote, '')
    }
  } catch {
    setNote(els.modeNote, '')
  }

  // Missing API key note
  try {
    const isLocalProvider = providerId === 'ollama' || providerId === 'lm-studio'
    if (!isLocalProvider) {
      const keyResult = await window.electronAPI.hasApiKey(providerId)
      const hasKey = !!(keyResult?.success && keyResult.hasApiKey)
      setNote(els.keyNote, hasKey ? '' : 'No API key configured for this provider. Model refresh may fail.')
    } else {
      setNote(els.keyNote, '')
    }
  } catch {
    setNote(els.keyNote, '')
  }
}

async function loadModelsFlow({ forceRefresh = false } = {}) {
  await loadProviderState()

  if (!state.providerId) {
    setStatus('No active provider.')
    return
  }

  // Refresh on open if cache is stale or models missing.
  const shouldForce = forceRefresh || state.allModels.length === 0
  await refreshModelsIfNeeded({ force: shouldForce })

  // Re-load provider meta after a refresh.
  await loadProviderState()

  applyFilter(els.search?.value || '')
  setStatus('')
}

function moveHighlight(delta) {
  const len = state.filteredModels.length
  if (!len) return

  const next = clampIndex((state.highlightedIndex >= 0 ? state.highlightedIndex : 0) + delta, len)
  state.highlightedIndex = next
  renderList()
  ensureHighlightVisible()
}

async function selectHighlighted() {
  if (state.isSaving) return
  const model = state.filteredModels[state.highlightedIndex]
  if (!model?.id || !state.providerId) return

  state.isSaving = true
  setStatus('Saving…')

  try {
    const providerConfigResult = await window.electronAPI.getProviderConfig(state.providerId)
    const providerConfig = providerConfigResult?.success ? (providerConfigResult.config || {}) : {}

    const result = await window.electronAPI.setProviderConfig(state.providerId, {
      ...providerConfig,
      model: model.id
    })

    if (!result?.success) {
      setStatus(result?.error || 'Failed to save model.')
      state.isSaving = false
      return
    }

    state.currentModelId = model.id
    setStatus('Saved.')
    await window.electronAPI.closeModelSwitcher?.()
  } catch (error) {
    setStatus(error?.message || 'Failed to save model.')
  } finally {
    state.isSaving = false
  }
}

async function handleProviderChange(newProviderId) {
  if (!newProviderId || newProviderId === state.providerId || state.isLoading) return

  state.isLoading = true
  setStatus('Switching provider…')

  try {
    // Update active provider
    await window.electronAPI.setActiveProvider(newProviderId)
    state.providerId = newProviderId

    // Reload provider state and models
    await loadModelsFlow({ forceRefresh: false })

    setStatus('Provider switched.')
  } catch (error) {
    setStatus(error?.message || 'Failed to switch provider.')
    // Revert dropdown to current provider
    if (els.providerSelect) {
      els.providerSelect.value = state.providerId
    }
  } finally {
    state.isLoading = false
  }
}

function wireEvents() {
  els.providerSelect?.addEventListener('change', async () => {
    const newProviderId = els.providerSelect?.value
    if (newProviderId) {
      await handleProviderChange(newProviderId)
    }
  })

  els.search?.addEventListener('input', () => {
    applyFilter(els.search.value)
  })

  els.refresh?.addEventListener('click', async () => {
    try {
      await loadModelsFlow({ forceRefresh: true })
    } catch (err) {
      setStatus(err?.message || 'Failed to refresh.')
    }
  })

  els.close?.addEventListener('click', () => {
    window.electronAPI.closeModelSwitcher?.()
  })

  els.list?.addEventListener('click', (e) => {
    const item = e.target.closest('.model-item')
    if (!item) return
    const idx = Number(item.getAttribute('data-index'))
    if (Number.isFinite(idx)) {
      state.highlightedIndex = idx
      renderList()
      ensureHighlightVisible()
      selectHighlighted().catch(console.error)
    }
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      window.electronAPI.closeModelSwitcher?.()
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveHighlight(1)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveHighlight(-1)
      return
    }

    if (e.key === 'Enter') {
      // When focus is on the search input, Enter should select.
      if (document.activeElement === els.search || document.activeElement === document.body) {
        e.preventDefault()
        selectHighlighted().catch(console.error)
      }
    }
  })
}

async function init() {
  await initIcons()
  
  const refreshIcon = els.refresh.querySelector('.nav-icon')
  const closeIcon = els.close.querySelector('.nav-icon')
  
  if (refreshIcon) insertIcon(refreshIcon, 'refresh', 'icon-svg')
  if (closeIcon) insertIcon(closeIcon, 'close', 'icon-svg')

  wireEvents()

  // Focus search on open
  setTimeout(() => {
    els.search?.focus()
    els.search?.select()
  }, 0)

  try {
    await loadModelsFlow({ forceRefresh: false })
  } catch (error) {
    setStatus(error?.message || 'Failed to load models.')
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
