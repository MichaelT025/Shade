import { initIcons, insertIcon } from './assets/icons/icons.js'

import { showToast } from './utils/ui-helpers.js'

const selectedSessionIds = new Set()

function formatTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function getDayLabel(iso) {
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

function groupSessionsByDay(sessions) {
  const groups = new Map()

  for (const session of sessions) {
    const key = getDayLabel(session.updatedAt || session.createdAt)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(session)
  }

  return groups
}

async function handleSessionClick(id) {
  await window.electronAPI.resumeSessionInOverlay(id)
}

let selectedModeIdToDelete = null

async function handleDeleteSession(id) {
  const result = await window.electronAPI.deleteSession(id)
  if (!result?.success) {
    showToast(result?.error || 'Failed to delete session', 'error')
  }

  // Remove from selection if present
  if (selectedSessionIds.has(id)) {
    selectedSessionIds.delete(id)
    updateBulkModeUI()
  }

  await loadSessions()
}

let renameModalTarget = 'session'
let renameModalId = null

function openRenameModal(id, currentTitle = '', target = 'session') {
  const backdrop = document.getElementById('rename-modal')
  const input = document.getElementById('rename-input')
  const status = document.getElementById('rename-status')
  const modalTitle = backdrop?.querySelector('h2')
  if (!backdrop || !input) return

  renameModalId = id
  renameModalTarget = target
  if (status) status.textContent = ''
  if (modalTitle) modalTitle.textContent = target === 'session' ? 'Rename conversation' : 'Rename mode'

  input.value = (currentTitle || '').trim() || (target === 'session' ? 'New Chat' : 'New Mode')
  backdrop.classList.add('open')

  // Focus + select for quick editing
  setTimeout(() => {
    input.focus()
    input.select()
  }, 0)
}

function closeRenameModal() {
  const backdrop = document.getElementById('rename-modal')
  const status = document.getElementById('rename-status')
  if (status) status.textContent = ''
  renameModalId = null
  backdrop?.classList.remove('open')
}

async function submitRenameModal() {
  const input = document.getElementById('rename-input')
  const status = document.getElementById('rename-status')
  const id = renameModalId
  const target = renameModalTarget
  if (!input || !id) return

  const finalTitle = (input.value || '').trim()
  
  if (!finalTitle) {
    if (status) {
      status.textContent = 'Name cannot be empty'
      status.style.color = 'var(--danger)'
    }
    return
  }
  
  let result
  if (target === 'session') {
    result = await window.electronAPI.renameSession(id, finalTitle)
  } else {
    const state = await fetchModesState(true)
    const mode = state.modes.find(m => m.id === id)
    if (mode) {
      mode.name = finalTitle
      await window.electronAPI.saveMode(mode)
      result = { success: true }
      cachedModes = null
    } else {
      result = { success: false, error: 'Mode not found' }
    }
  }

  if (result?.success) {
    closeRenameModal()
    if (target === 'session') {
      await loadSessions()
    } else {
      if (modesViewInitialized) {
        const listEl = document.getElementById('modes-list')
        const editorEl = document.getElementById('mode-editor')
        const s = await fetchModesState(true)
        renderModesList(listEl, s)
        await renderModeEditor(editorEl, s)
      }
    }
  } else {
    if (status) status.textContent = result?.error || 'Failed to rename.'
  }
}

async function handleRenameSession(id) {
  // Find current title from DOM to pre-fill
  let currentTitle = ''
  const card = document.querySelector(`.session-card[data-session-id="${id}"]`)
  if (card) {
    currentTitle = card.querySelector('.session-title')?.textContent || ''
  }

  openRenameModal(id, currentTitle, 'session')
}

let showingSaved = false
let isFirstRunMode = false

async function handleToggleSaved(id) {
  const result = await window.electronAPI.toggleSessionSaved(id)
  if (!result?.success) {
    showToast('Failed to update saved status: ' + (result?.error || 'Unknown error'), 'error')
  }
  // Refresh list
  await loadSessions()
}

async function handleNewChat() {
  await window.electronAPI.startNewChatInOverlay()
}

function renderEmptyState(container) {
  if (showingSaved) {
    container.innerHTML = `
      <div class="empty">
        <h2>No saved conversations</h2>
        <p>Save important conversations to see them here.</p>
      </div>
    `
    return
  }

  container.innerHTML = `
    <div class="empty">
      <h2>No conversations yet</h2>
      <p>Start a new chat to see it here. Tip: Press <code>Ctrl+R</code> to start a new chat from anywhere.</p>
      <button id="empty-new-chat" class="action-btn primary" type="button" style="width: 200px; margin-top: var(--space-12);">
        <span class="nav-icon" data-icon="newchat"></span>
        New chat
      </button>
    </div>
  `

  const iconSpan = container.querySelector('[data-icon="newchat"]')
  if (iconSpan) {
    insertIcon(iconSpan, 'newchat')
  }

  const btn = document.getElementById('empty-new-chat')
  if (btn) {
    btn.addEventListener('click', handleNewChat)
  }
}

function toggleBulkModeUI(active) {
  const container = document.querySelector('.quick-actions')
  if (!container) return

  container.innerHTML = ''

  if (active) {
    container.style.gridTemplateColumns = '1fr 1fr 1fr'

    // Button 1: Delete
    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'action-btn danger'
    deleteBtn.type = 'button'
    deleteBtn.innerHTML = `<span class="nav-icon" data-icon="trash"></span> Delete (${selectedSessionIds.size})`
    
    deleteBtn.addEventListener('click', () => {
      const count = selectedSessionIds.size
      if (count === 0) return
      
      const modal = document.getElementById('delete-sessions-modal')
      const title = document.getElementById('delete-sessions-title')
      const msg = document.getElementById('delete-sessions-msg')
      
      if (title) title.textContent = `Delete ${count} Conversation${count === 1 ? '' : 's'}?`
      if (msg) msg.textContent = `Are you sure you want to permanently delete ${count} conversation${count === 1 ? '' : 's'}? This action cannot be undone.`
      
      modal?.classList.add('open')
      const iconSpan = modal?.querySelector('[data-icon="trash"]')
      if (iconSpan) insertIcon(iconSpan, 'trash')
    })
    container.appendChild(deleteBtn)

    // Button 2: Save
    const saveBtn = document.createElement('button')
    saveBtn.className = 'action-btn'
    saveBtn.type = 'button'
    saveBtn.innerHTML = `<span class="nav-icon" data-icon="save"></span> Save`
    
    saveBtn.addEventListener('click', async () => {
      const count = selectedSessionIds.size
      if (count === 0) return

      for (const id of selectedSessionIds) {
        await window.electronAPI.setSessionSaved(id, true)
      }
      
      selectedSessionIds.clear()
      updateBulkModeUI()
      await loadSessions()
    })
    container.appendChild(saveBtn)

    // Button 3: Cancel
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'action-btn'
    cancelBtn.type = 'button'
    cancelBtn.innerHTML = `<span class="nav-icon" data-icon="close"></span> Cancel`
    
    cancelBtn.addEventListener('click', () => {
      selectedSessionIds.clear()
      updateBulkModeUI()
      loadSessions() // Re-render to uncheck boxes
    })
    container.appendChild(cancelBtn)

  } else {
    container.style.gridTemplateColumns = '1fr 1fr'

    // Button 1: New Chat
    const newChatBtn = document.createElement('button')
    newChatBtn.id = 'new-chat'
    newChatBtn.className = 'action-btn primary'
    newChatBtn.type = 'button'
    newChatBtn.innerHTML = `<span class="nav-icon" data-icon="newchat"></span> New chat`
    newChatBtn.addEventListener('click', handleNewChat)
    container.appendChild(newChatBtn)

    // Button 2: Saved
    const savedBtn = document.createElement('button')
    savedBtn.id = 'saved-messages'
    savedBtn.className = showingSaved ? 'action-btn active' : 'action-btn'
    savedBtn.type = 'button'
    savedBtn.innerHTML = `<span class="nav-icon" data-icon="save"></span> ${showingSaved ? 'All Chats' : 'Saved'}`
    savedBtn.addEventListener('click', () => {
      showingSaved = !showingSaved
      
      // Update button text/state immediately
      savedBtn.innerHTML = `<span class="nav-icon" data-icon="save"></span> ${showingSaved ? 'All Chats' : 'Saved'}`
      if (showingSaved) {
        savedBtn.classList.add('active')
      } else {
        savedBtn.classList.remove('active')
      }
      insertIcon(savedBtn.querySelector('.nav-icon'), 'save')

      const searchInput = document.getElementById('search-input')
      if (searchInput) {
        searchInput.value = ''
      }
      
      loadSessions().catch(console.error)
    })
    container.appendChild(savedBtn)
  }

  // Inject icons
  container.querySelectorAll('[data-icon]').forEach(el => {
    insertIcon(el, el.dataset.icon)
  })
}

function updateBulkModeUI() {
  const active = selectedSessionIds.size > 0
  toggleBulkModeUI(active)
}

function renderSessionList(container, sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    renderEmptyState(container)
    return
  }

  const groups = groupSessionsByDay(sessions)

  container.innerHTML = ''

  for (const [label, items] of groups.entries()) {
    const header = document.createElement('div')
    header.className = 'date-header'
    header.textContent = label
    container.appendChild(header)

    for (const session of items) {
      const card = document.createElement('div')
      card.className = 'session-card'
      card.setAttribute('role', 'button')
      card.setAttribute('tabindex', '0')
      card.dataset.sessionId = session.id 

      const checkboxContainer = document.createElement('div')
      checkboxContainer.className = 'session-checkbox-container'
      
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.className = 'session-checkbox'
      checkbox.checked = selectedSessionIds.has(session.id)
      
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation()
      })
      
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedSessionIds.add(session.id)
        } else {
          selectedSessionIds.delete(session.id)
        }
        updateBulkModeUI()
      })

      checkboxContainer.appendChild(checkbox)
      card.appendChild(checkboxContainer)

      const left = document.createElement('div')
      left.className = 'session-left'

      const title = document.createElement('div')
      title.className = 'session-title'
      
      if (session.isSaved) {
        const starSpan = document.createElement('span')
        starSpan.className = 'star-icon'
        starSpan.dataset.icon = 'star'
        title.appendChild(starSpan)
        insertIcon(starSpan, 'star')
        
        const titleText = document.createElement('span')
        titleText.textContent = session.title || 'New Chat'
        title.appendChild(titleText)
      } else {
        title.textContent = session.title || 'New Chat'
      }

      const subtitle = document.createElement('div')
      subtitle.className = 'session-subtitle'
      subtitle.textContent = session.provider ? `${session.provider}${session.model ? ` • ${session.model}` : ''}` : ''

      left.appendChild(title)
      left.appendChild(subtitle)

      const right = document.createElement('div')
      right.className = 'session-right'

      const count = document.createElement('span')
      count.className = 'pill'
      const messageCount = Number.isFinite(session.messageCount) ? session.messageCount : 0
      count.textContent = `${messageCount} msg${messageCount === 1 ? '' : 's'}`

      const time = document.createElement('span')
      time.className = 'timestamp'
      time.textContent = formatTime(session.updatedAt || session.createdAt)

      const renameBtn = document.createElement('button')
      renameBtn.className = 'icon-mini'
      renameBtn.type = 'button'
      renameBtn.title = 'Rename session'

      const pencilIconSpan = document.createElement('span')
      pencilIconSpan.className = 'nav-icon'
      pencilIconSpan.setAttribute('data-icon', 'pencil')
      renameBtn.appendChild(pencilIconSpan)
      insertIcon(pencilIconSpan, 'pencil')

      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        handleRenameSession(session.id)
      })

      const deleteBtn = document.createElement('button')
      deleteBtn.className = 'icon-mini danger'
      deleteBtn.type = 'button'
      deleteBtn.title = 'Delete session'
      
      const trashIconSpan = document.createElement('span')
      trashIconSpan.className = 'nav-icon'
      trashIconSpan.setAttribute('data-icon', 'trash')
      
      deleteBtn.appendChild(trashIconSpan)
      insertIcon(trashIconSpan, 'trash')
      
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        handleDeleteSession(session.id)
      })

      right.appendChild(count)
      right.appendChild(time)
      right.appendChild(renameBtn)
      right.appendChild(deleteBtn)

      const activate = () => {
        if (selectedSessionIds.size > 0) {
          if (selectedSessionIds.has(session.id)) {
            selectedSessionIds.delete(session.id)
            checkbox.checked = false
          } else {
            selectedSessionIds.add(session.id)
            checkbox.checked = true
          }
          updateBulkModeUI()
          return
        }
        handleSessionClick(session.id)
      }

      card.addEventListener('click', activate)
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          activate()
        }
      })
      
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        window.electronAPI.showSessionContextMenu(session.id)
      })

      card.appendChild(left)
      card.appendChild(right)
      
      container.appendChild(card)
    }
  }
}

let searchTimer = null

async function loadSessions(query = '') {
  const container = document.getElementById('content')
  if (!container) return

  // Prevent loading sessions if we are in first-run mode
  const isFirstRun = await checkFirstRunState()
  if (isFirstRun) {
    showFirstRunExperience()
    return
  }

  const trimmed = (query || '').trim()
  let result = trimmed
    ? await window.electronAPI.searchSessions(trimmed)
    : await window.electronAPI.getAllSessions()

  let sessions = result?.success ? (result.sessions || []) : []

  if (showingSaved) {
    sessions = sessions.filter(s => s.isSaved)
  }

  if (!result?.success && result?.error) {
    container.innerHTML = `<div class="empty"><h2>Couldn’t load sessions</h2><p>${result.error}</p></div>`
    return
  }

  renderSessionList(container, sessions)
}

function showView(viewId) {
  const views = document.querySelectorAll('.view-container')
  let found = false
  
  views.forEach(el => {
    if (el.id === viewId) {
      if (el.classList.contains('active')) {
        found = true
        return
      }
      el.style.display = 'flex'
      // Use timeout to ensure display: flex is applied before adding active class for animation
      setTimeout(() => el.classList.add('active'), 10)
      found = true
    } else {
      el.classList.remove('active')
      el.style.display = 'none'
    }
  })
}

let configViewInitialized = false
let modesViewInitialized = false
let cachedProvidersMeta = null
let cachedActiveProvider = null

let cachedModes = null
let cachedActiveModeId = null
let selectedModeId = null
let modeSaveTimer = null

function normalizeProvidersMeta(providers) {
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

function getProviderLabel(provider) {
  return provider?.label || provider?.displayName || provider?.name || provider?.id
}

function extractModelsFromProviderMeta(providerMeta) {
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

async function fetchConfigurationState(force = false) {
  if (!force && cachedProvidersMeta && cachedActiveProvider) {
    return { providers: cachedProvidersMeta, activeProvider: cachedActiveProvider }
  }

  const [providersResult, activeResult] = await Promise.all([
    window.electronAPI.getAllProvidersMeta(),
    window.electronAPI.getActiveProvider()
  ])

  const providers = normalizeProvidersMeta(providersResult?.success ? providersResult.providers : null)
  const activeProvider = activeResult?.success ? activeResult.provider : ''

  cachedProvidersMeta = providers
  cachedActiveProvider = activeProvider

  return { providers, activeProvider }
}

function renderConfig(container, state) {
  const providers = state.providers || []

  if (!Array.isArray(providers) || providers.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <h2>Couldn’t load providers</h2>
        <p>Try restarting Shade, or check your configuration.</p>
      </div>
    `
    return
  }

  const activeProvider = state.activeProvider || (providers[0]?.id || '')

  const providerOptions = providers
    .slice()
    .sort((a, b) => getProviderLabel(a).localeCompare(getProviderLabel(b)))
    .map(p => `<option value="${p.id}">${getProviderLabel(p)}</option>`)
    .join('')

  container.innerHTML = `
    <div class="config-card">
      <h2>Provider</h2>
      <p>Select which provider Shade uses for new chats.</p>
      <div class="form-row">
        <div class="form-field">
          <label for="config-provider">Active provider</label>
          <select id="config-provider" class="select-input">
            ${providerOptions}
          </select>
        </div>
      </div>
    </div>

     <div id="config-api-key-card" class="config-card">
      <h2>API Key</h2>
      <div class="form-row">
        <div class="form-field" style="min-width: 320px;">
          <label for="config-api-key">API key</label>
          <input id="config-api-key" class="text-input" type="password" placeholder="Enter API key" autocomplete="off" />
          <div id="config-key-status" class="status-line"></div>
        </div>
        <div class="inline-actions">
          <button id="config-key-save" class="mini-btn primary" type="button">Save</button>
          <button id="config-key-clear" class="mini-btn danger" type="button">Clear</button>
          <button id="config-key-test" class="mini-btn" type="button">Test key</button>
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2>Models</h2>
      <p>Choose the default model for the active provider.</p>
      <div class="form-row">
        <div class="form-field">
          <label for="config-model-search">Search models</label>
          <input id="config-model-search" class="text-input" type="text" placeholder="Search by name" autocomplete="off" />
          <div class="helper-text">Some models don't support screenshots.</div>
          <div class="helper-text">Some models might not work with this application.</div>
        </div>
        <div class="inline-actions">
          <button id="config-refresh-models" class="mini-btn" type="button">Refresh models</button>
        </div>
      </div>
      <div class="form-row" style="margin-top: var(--space-12);">
        <div class="form-field">
          <label>Default model</label>
          <div id="config-model-status" class="status-line" style="margin-top: 0; margin-bottom: 8px;"></div>
          <div id="config-model-list" class="model-list"></div>
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2>Sessions</h2>
      <p>Control session naming and startup behavior.</p>
      <div class="form-row">
        <div class="form-field">
          <label>Auto-title sessions</label>
          <div class="inline-actions">
            <label class="toggle-switch" aria-label="Auto-title sessions">
              <input id="config-auto-title" type="checkbox" />
              <span class="toggle-slider"></span>
            </label>
            <div id="config-auto-title-msg" class="helper-text" style="margin-top: 0;"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2>Default startup behavior</h2>
      <p>Choose how Shade opens by default.</p>
      <div class="form-row">
        <div class="form-field">
          <label>Start overlay collapsed</label>
          <div class="inline-actions">
            <label class="toggle-switch" aria-label="Start overlay collapsed">
              <input id="config-start-collapsed" type="checkbox" />
              <span class="toggle-slider"></span>
            </label>
            <div id="config-start-collapsed-msg" class="helper-text" style="margin-top: 0;"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2>Screenshots</h2>
      <p>Control whether screenshots auto-attach when you send.</p>
      <div class="form-row">
        <div class="form-field">
          <label>Auto-attach screenshots</label>
          <div class="inline-actions">
            <label class="toggle-switch" aria-label="Auto-attach screenshots">
              <input id="config-screenshot-mode" type="checkbox" />
              <span class="toggle-slider"></span>
            </label>
            <div id="config-screenshot-mode-msg" class="helper-text" style="margin-top: 0;"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2>Memory</h2>
      <p>Control what gets persisted to sessions.</p>
      <div class="form-row">
        <div class="form-field">
          <label>Exclude screenshots from memory</label>
          <div class="inline-actions">
            <label class="toggle-switch" aria-label="Exclude screenshots from memory">
              <input id="config-exclude-screenshots" type="checkbox" />
              <span class="toggle-slider"></span>
            </label>
            <div id="config-exclude-screenshots-msg" class="helper-text" style="margin-top: 0;"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2>Data Management</h2>
      <p>Access your local data files.</p>
      <div class="form-row">
        <div class="form-field">
          <label>Local Data Folder</label>
          <div class="inline-actions">
            <button id="config-open-data" class="mini-btn" type="button">
              <span class="nav-icon" data-icon="files" style="margin-right: 6px;"></span>
              Open Data Folder
            </button>
            <div class="helper-text" style="margin-top: 0;">Contains your sessions, screenshots, and config (including encrypted API keys).</div>
          </div>
        </div>
      </div>
    </div>
  `

  const providerSelect = container.querySelector('#config-provider')
  if (providerSelect) providerSelect.value = activeProvider
}

function setStatus(el, text, kind) {
  if (!el) return
  el.textContent = text
  el.classList.remove('good', 'bad')
  if (kind === 'good') el.classList.add('good')
  if (kind === 'bad') el.classList.add('bad')
}

async function fetchModesState(force = false) {
  if (!force && cachedModes && cachedActiveModeId) {
    return { modes: cachedModes, activeModeId: cachedActiveModeId }
  }

  const [modesResult, activeResult] = await Promise.all([
    window.electronAPI.getModes(),
    window.electronAPI.getActiveMode()
  ])

  const modes = modesResult?.success ? (modesResult.modes || []) : (modesResult?.modes || [])
  const activeModeId = activeResult?.success ? (activeResult.modeId || 'default') : (activeResult?.modeId || 'default')

  cachedModes = modes
  cachedActiveModeId = activeModeId

  return { modes, activeModeId }
}

function sanitizeMode(mode) {
  return {
    id: mode.id,
    name: (mode.name || '').trim() || 'New Mode',
    prompt: mode.prompt || '',

    // Optional per-mode defaults (only applied when explicitly enabled).
    overrideProviderModel: !!mode.overrideProviderModel,
    provider: mode.provider || '',
    model: mode.model || '',

    isDefault: !!mode.isDefault
  }
}

function renderModesList(container, state) {
  const modes = (state.modes || []).slice()
  const activeModeId = state.activeModeId || 'default'

  if (!modes.length) {
    container.innerHTML = `<div class="status-line">No modes found.</div>`
    return
  }

  container.innerHTML = modes
    .map(m => {
      const mode = sanitizeMode(m)
      const isActive = mode.id === activeModeId
      const isSelected = mode.id === selectedModeId
       const subtitleParts = []
       if (mode.overrideProviderModel) {
         if (mode.provider) subtitleParts.push(mode.provider)
         if (mode.model) subtitleParts.push(mode.model)
       }
       const subtitle = subtitleParts.length
         ? subtitleParts.join(' • ')
         : (mode.overrideProviderModel ? 'Select a provider/model' : 'Uses Configuration provider/model')


      return `
        <div class="mode-item ${isSelected ? 'active' : ''}" data-mode-id="${mode.id}">
          <div class="mode-meta">
            <div class="mode-name">
              ${mode.name}
              ${isActive ? ' <span class="badge badge-info" style="margin-left: 8px; font-size: 10px; padding: 1px 6px;">Active</span>' : ''}
            </div>
            <div class="mode-sub">${subtitle}</div>
          </div>
          <div class="mode-actions">
            <button class="icon-mini" data-action="rename-mode" data-mode-id="${mode.id}" type="button" title="Rename mode"><span class="nav-icon" data-icon="pencil"></span></button>
            ${!mode.isDefault ? `<button class="icon-mini danger" data-action="delete-mode" data-mode-id="${mode.id}" type="button" title="Delete mode"><span class="nav-icon" data-icon="trash"></span></button>` : ''}
            ${isSelected ? '<span class="nav-icon" data-icon="check" style="color: var(--accent); width: 16px; height: 16px;"></span>' : ''}
          </div>
        </div>
      `
    })
    .join('')

  // icons
  container.querySelectorAll('[data-icon="trash"]').forEach(el => insertIcon(el, 'trash'))
  container.querySelectorAll('[data-icon="check"]').forEach(el => insertIcon(el, 'check'))
  container.querySelectorAll('[data-icon="pencil"]').forEach(el => insertIcon(el, 'pencil'))
}

async function renderModeEditor(container, state) {
  const modes = state.modes || []
  const mode = modes.find(m => m.id === selectedModeId) || modes.find(m => m.id === state.activeModeId) || modes[0]

  if (!mode) {
    container.innerHTML = `
      <div class="config-card">
        <div class="empty" style="margin-top: 0;">
          <h2>No mode selected</h2>
          <p>Select a mode above or create a new one to configure.</p>
        </div>
      </div>`
    return
  }

  selectedModeId = mode.id
  const sanitized = sanitizeMode(mode)

  const recommendations = {
    'bolt': 'Gemini Gemini 2.5 Flash',
    'tutor': 'OpenAI GPT-4o',
    'coder': 'OpenAI GPT-4o',
    'thinker': 'OpenAI GPT-5.2'
  }
  const recommendation = recommendations[mode.id]
  const recommendationHtml = recommendation 
    ? `<div class="helper-text" style="margin-bottom: var(--space-12); color: var(--accent); font-weight: 500;">Recommended model: ${recommendation}</div>`
    : ''

  const { providers, activeProvider } = await fetchConfigurationState()

  const overridesEnabled = !!sanitized.overrideProviderModel

  const providerOptions = (providers || [])
    .slice()
    .sort((a, b) => getProviderLabel(a).localeCompare(getProviderLabel(b)))
    .map(p => `<option value="${p.id}">${getProviderLabel(p)}</option>`)
    .join('')

  const providerId = sanitized.provider || activeProvider || (providers?.[0]?.id || '')

  container.innerHTML = `
    <div class="config-card">
      <h2>Model Defaults</h2>
      ${recommendationHtml}

      <div class="form-row">
        <div class="form-field">
          <label>Override Configuration provider/model</label>
          <div class="inline-actions">
            <label class="toggle-switch" aria-label="Override Configuration provider/model">
              <input id="mode-override-provider-model" type="checkbox" ${overridesEnabled ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
            <div class="helper-text" style="margin-top: 0;">
              When off, this mode only changes the system prompt.
            </div>
          </div>
        </div>
      </div>

      <div id="mode-provider-model-panel" class="mode-provider-model-panel ${overridesEnabled ? '' : 'is-collapsed'}">
        <div class="form-row">
          <div class="form-field">
            <label for="mode-provider">Provider</label>
            <select id="mode-provider" class="select-input">${providerOptions}</select>
          </div>
        </div>

        <div class="form-row" style="margin-top: var(--space-12);">
          <div class="form-field">
            <label for="mode-model-search">Search models</label>
            <div class="helper-text" style="margin-bottom: var(--space-8);">Click a model below to select it.</div>
            <input id="mode-model-search" class="text-input" type="text" placeholder="Search by name" autocomplete="off" />
          </div>
        </div>

        <div id="mode-model-list" class="model-list" style="max-height: 240px; margin-top: var(--space-8);" aria-label="Mode models"></div>
      </div>
    </div>

    <div class="config-card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <h2>System Prompt</h2>
          <p>This prompt defines the AI's behavior in this mode.</p>
        </div>
        <button id="mode-reset-prompt" class="mini-btn" type="button" style="font-size: 10px; padding: 2px 8px; border-color: rgba(255,255,255,0.1);">
          ${mode.isDefault ? 'Reset to Default' : 'Clear Prompt'}
        </button>
      </div>
      <textarea id="mode-prompt" class="textarea" style="min-height: 300px;" placeholder="Enter system prompt instructions...">${(sanitized.prompt || '').replace(/</g, '&lt;')}</textarea>
      <div class="helper-text" style="margin-top: var(--space-8);">Changes are saved automatically.</div>
    </div>
  `

  const panel = container.querySelector('#mode-provider-model-panel')
  const overrideToggle = container.querySelector('#mode-override-provider-model')
  const providerSelect = container.querySelector('#mode-provider')
  const modelSearch = container.querySelector('#mode-model-search')

  const setPanelEnabled = (enabled) => {
    if (panel) panel.classList.toggle('is-collapsed', !enabled)

    if (providerSelect) providerSelect.disabled = !enabled
    if (modelSearch) modelSearch.disabled = !enabled

    if (!enabled) {
      const listEl = container.querySelector('#mode-model-list')
      if (listEl) listEl.innerHTML = ''
    }
  }

  if (providerSelect) providerSelect.value = providerId
  setPanelEnabled(overridesEnabled)

  let overrideToggleSeq = 0

  if (overrideToggle) {
    overrideToggle.addEventListener('change', async () => {
      const seq = ++overrideToggleSeq
      const enabled = !!overrideToggle.checked

      // Update UI immediately so rapid toggles feel responsive.
      setPanelEnabled(enabled)

      const modeToSave = {
        ...sanitized,
        overrideProviderModel: enabled,
        provider: providerSelect?.value || sanitized.provider || providerId,
        model: sanitized.model
      }
      scheduleModeSave(modeToSave)

      if (enabled) {
        const providerForList = providerSelect?.value || providerId
        await updateModeModelList(container, providerForList, modeToSave.model)
        if (seq !== overrideToggleSeq) return
      }
    })
  }

  if (overridesEnabled) {
    await updateModeModelList(container, providerId, sanitized.model)
  }
}

async function updateModeModelList(editorEl, providerId, selectedModelId) {
  const list = editorEl.querySelector('#mode-model-list')
  const search = editorEl.querySelector('#mode-model-search')

  const state = await fetchConfigurationState()
  const providerMeta = (state.providers || []).find(p => p.id === providerId)
  const models = extractModelsFromProviderMeta(providerMeta).sort((a, b) => (a.id || '').localeCompare(b.id || ''))
  const q = (search?.value || '').trim()

  let filtered
  if (!q) {
    filtered = models
  } else {
    filtered = models
      .map(m => ({ model: m, match: scoreModelMatch(m, q) }))
      .filter(x => x.match)
      .sort((a, b) => {
        if (b.match.score !== a.match.score) return b.match.score - a.match.score
        return (a.model.id || '').localeCompare(b.model.id || '')
      })
      .map(x => x.model)
  }

  if (selectedModelId) {
    const idx = filtered.findIndex(m => m.id === selectedModelId)
    if (idx > 0) {
      const [sel] = filtered.splice(idx, 1)
      filtered = [sel, ...filtered]
    }
  }

  if (!list) return

  if (!filtered.length) {
    list.innerHTML = `<div class="status-line">No models found.</div>`
    return
  }

  list.innerHTML = filtered
    .map(m => {
      const isActive = m.id === selectedModelId
      return `
        <div class="model-item ${isActive ? 'active' : ''}" data-model-id="${m.id}">
          <span style="font-size: 13px; font-weight: 500;">${m.id}</span>
          ${isActive ? '<span class="nav-icon" data-icon="check" style="color: var(--accent); width: 14px; height: 14px;"></span>' : ''}
        </div>
      `
    })
    .join('')

  list.querySelectorAll('[data-icon="check"]').forEach(el => insertIcon(el, 'check'))
}

function scheduleModeSave(mode) {
  if (modeSaveTimer) clearTimeout(modeSaveTimer)
  modeSaveTimer = setTimeout(async () => {
    try {
      await window.electronAPI.saveMode(mode)
      cachedModes = null
    } catch (e) {
      console.error('Failed to save mode:', e)
    }
  }, 250)
}


async function initModesView() {
  const listEl = document.getElementById('modes-list')
  const editorEl = document.getElementById('mode-editor')
  const newBtn = document.getElementById('mode-new')

  if (!listEl || !editorEl) return

  const state = await fetchModesState(true)
  selectedModeId = selectedModeId || state.activeModeId || (state.modes?.[0]?.id || 'default')

  const rerender = async () => {
    const s = await fetchModesState(true)
    renderModesList(listEl, s)
    await renderModeEditor(editorEl, s)
  }

  // Restore Defaults Global Action
  const restoreBtn = document.getElementById('modes-restore-defaults')
  const restoreModal = document.getElementById('restore-modes-modal')
  const restoreConfirm = document.getElementById('restore-modes-confirm')
  const restoreCancel = document.getElementById('restore-modes-cancel')

  restoreBtn?.addEventListener('click', () => {
    restoreModal?.classList.add('open')
  })

  restoreCancel?.addEventListener('click', () => {
    restoreModal?.classList.remove('open')
  })

  // Insert icon for restore button
  const restoreIconEl = restoreBtn?.querySelector('[data-icon="refresh"]')
  if (restoreIconEl) insertIcon(restoreIconEl, 'refresh', 'nav-icon')
  
  // Insert icon for restore modal
  const restoreModalIconEl = restoreModal?.querySelector('[data-icon="refresh"]')
  if (restoreModalIconEl) insertIcon(restoreModalIconEl, 'refresh', 'nav-icon')

  restoreConfirm?.addEventListener('click', async () => {
    restoreConfirm.disabled = true
    restoreConfirm.textContent = 'Resetting...'
    try {
      await window.electronAPI.resetModes()
      cachedModes = null
      selectedModeId = 'bolt'
      await rerender()
      restoreModal?.classList.remove('open')
    } catch (err) {
      console.error('Failed to reset modes:', err)
      showToast('Failed to reset modes: ' + err.message, 'error')
    } finally {
      restoreConfirm.disabled = false
      restoreConfirm.textContent = 'Reset Everything'
    }
  })

  // Reset Prompt Modal
  const resetPromptModal = document.getElementById('reset-prompt-modal')
  const resetPromptConfirm = document.getElementById('reset-prompt-confirm')
  const resetPromptCancel = document.getElementById('reset-prompt-cancel')

  resetPromptCancel?.addEventListener('click', () => {
    resetPromptModal?.classList.remove('open')
  })

  // Insert icon for reset prompt modal
  const resetPromptModalIconEl = resetPromptModal?.querySelector('[data-icon="refresh"]')
  if (resetPromptModalIconEl) insertIcon(resetPromptModalIconEl, 'refresh', 'nav-icon')

   resetPromptConfirm?.addEventListener('click', async () => {
     resetPromptConfirm.disabled = true
     resetPromptConfirm.textContent = 'Resetting...'
     try {
       const s = await fetchModesState(true)
       const mode = s.modes.find(m => m.id === selectedModeId)
       if (mode) {
         const defaultModesResult = await window.electronAPI.getDefaultModes()
         const defaultMode = (defaultModesResult?.modes || []).find(m => m.id === mode.id)

         // Default modes reset to factory prompt; user-made modes clear prompt.
         mode.prompt = defaultMode ? (defaultMode.prompt || '') : ''

         await window.electronAPI.saveMode(mode)
         cachedModes = null
         await rerender()
       }
       resetPromptModal?.classList.remove('open')
     } catch (err) {
       console.error('Failed to reset prompt:', err)
       showToast('Failed to reset prompt: ' + err.message, 'error')
     } finally {
       resetPromptConfirm.disabled = false
       resetPromptConfirm.textContent = 'Reset Prompt'
     }
   })

  newBtn?.addEventListener('click', async () => {
    const mode = {
      id: 'mode-' + Date.now(),
      name: 'New Mode',
      prompt: '',
      provider: cachedActiveProvider || '',
      model: ''
    }
    await window.electronAPI.saveMode(mode)
    cachedModes = null
    const s = await fetchModesState(true)
    selectedModeId = mode.id
    renderModesList(listEl, s)
    await renderModeEditor(editorEl, s)
  })

  listEl.addEventListener('click', async (e) => {
    const item = e.target.closest('.mode-item')
    const action = e.target.closest('[data-action]')

    if (action) {
      const modeId = action.getAttribute('data-mode-id')
      const act = action.getAttribute('data-action')
      if (!modeId) return

      if (act === 'delete-mode') {
        selectedModeIdToDelete = modeId
        const modal = document.getElementById('delete-mode-modal')
        modal?.classList.add('open')
        const iconSpan = modal?.querySelector('[data-icon="trash"]')
        if (iconSpan) insertIcon(iconSpan, 'trash')
      } else if (act === 'rename-mode') {
        const s = await fetchModesState(true)
        const mode = s.modes.find(m => m.id === modeId)
        if (mode) {
          openRenameModal(modeId, mode.name, 'mode')
        }
      }
      return
    }

    if (item) {
      const modeId = item.getAttribute('data-mode-id')
      if (!modeId) return
      
      // Select and Activate simultaneously
      selectedModeId = modeId
       await window.electronAPI.setActiveMode(modeId)
       cachedActiveModeId = modeId
       cachedModes = null
       await rerender()
    }
  })

  editorEl.addEventListener('input', async (e) => {
    const s = await fetchModesState(true)
    const mode = sanitizeMode(s.modes.find(m => m.id === selectedModeId) || {})
    if (!mode.id) return

    if (e.target.id === 'mode-model-search') {
      const providerId = editorEl.querySelector('#mode-provider')?.value || ''
      await updateModeModelList(editorEl, providerId, mode.model)
      return
    } else if (e.target.id === 'mode-prompt') {
      mode.prompt = e.target.value
    }

    scheduleModeSave(mode)
  })

  editorEl.addEventListener('change', async (e) => {
    const s = await fetchModesState(true)
    const mode = sanitizeMode(s.modes.find(m => m.id === selectedModeId) || {})
    if (!mode.id) return

    // mode-override-provider-model is handled directly in renderModeEditor
    // so the UI stays responsive and doesn't re-render with stale config.
    if (e.target.id === 'mode-provider') {
      mode.provider = e.target.value
      mode.model = ''
      scheduleModeSave(mode)
      await updateModeModelList(editorEl, mode.provider, mode.model)
    }
  })

  editorEl.addEventListener('click', async (e) => {
     const resetPromptBtn = e.target.closest('#mode-reset-prompt')
     if (resetPromptBtn) {
       const modal = document.getElementById('reset-prompt-modal')
       const s = await fetchModesState(true)
       const mode = s.modes.find(m => m.id === selectedModeId)
       const p = modal?.querySelector('p')
       if (p) {
         p.textContent = mode?.isDefault
           ? "This will revert the system prompt for this mode to its original factory setting. Your provider and model selections will not be changed."
           : "This will clear the system prompt for this mode. Your provider and model selections will not be changed."
       }
       modal?.classList.add('open')
       return
     }

    const modelItem = e.target.closest('.model-item')
    if (modelItem && modelItem.getAttribute('data-model-id')) {
      const modelId = modelItem.getAttribute('data-model-id')
      const s = await fetchModesState(true)
      const mode = sanitizeMode(s.modes.find(m => m.id === selectedModeId) || {})
      const providerId = editorEl.querySelector('#mode-provider')?.value || ''
      mode.provider = providerId
      mode.model = modelId
      scheduleModeSave(mode)
      await updateModeModelList(editorEl, providerId, modelId)
    }
  })

  await rerender()
  modesViewInitialized = true
}

const modelRefreshInFlight = new Map()
const lastModelRefreshAt = new Map()

async function refreshProviderModels(container, providerId, { force = false, reason = '' } = {}) {
  if (!providerId) return { skipped: true }

  const now = Date.now()
  const last = lastModelRefreshAt.get(providerId) || 0
  const tooSoon = now - last < 2 * 60 * 1000

  if (!force && (modelRefreshInFlight.has(providerId) || tooSoon)) {
    return { skipped: true }
  }

  const run = (async () => {
    try {
      lastModelRefreshAt.set(providerId, now)
      const result = await window.electronAPI.refreshModels(providerId)
      if (!result?.success) {
        return { success: false, error: result?.error || 'Failed to refresh models.' }
      }

      cachedProvidersMeta = null
      await fetchConfigurationState(true)
      await updateProviderDependentUI(container, providerId)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    } finally {
      modelRefreshInFlight.delete(providerId)
    }
  })()

  modelRefreshInFlight.set(providerId, run)
  return run
}

async function updateProviderDependentUI(container, providerId) {
  const keyInput = container.querySelector('#config-api-key')
  const keyStatus = container.querySelector('#config-key-status')
  const modelList = container.querySelector('#config-model-list')
  const modelStatus = container.querySelector('#config-model-status')
  const modelSearch = container.querySelector('#config-model-search')
  const apiKeyCard = container.querySelector('#config-api-key-card')

  const isLocalProvider = providerId === 'ollama' || providerId === 'lm-studio'
  if (apiKeyCard) {
    apiKeyCard.style.display = isLocalProvider ? 'none' : 'block'
  }

  setStatus(keyStatus, '', null)
  setStatus(modelStatus, '', null)

  const [keyResult, providerConfigResult, state] = await Promise.all([
    window.electronAPI.getApiKey(providerId),
    window.electronAPI.getProviderConfig(providerId),
    fetchConfigurationState()
  ])

  const apiKey = keyResult?.success ? (keyResult.apiKey || '') : ''
  if (keyInput) {
    keyInput.value = apiKey
  }

  const providerConfig = providerConfigResult?.success ? (providerConfigResult.config || {}) : {}
  const selectedModelId = providerConfig.model || ''

  const providerMeta = (state.providers || []).find(p => p.id === providerId)

  // Avoid showing the embedded/default model list until we've refreshed at least once.
  // We still *attempt* a refresh automatically when possible.
  const hasFetchedModels = !!providerMeta?.lastFetched
  const canAutoRefresh = isLocalProvider || providerMeta?.type === 'anthropic' || !!apiKey

  if (!hasFetchedModels) {
    if (modelList) {
      modelList.innerHTML = '<div class="status-line">Fetching models…</div>'
    }

    if (canAutoRefresh && !modelRefreshInFlight.has(providerId)) {
      refreshProviderModels(container, providerId, { force: true, reason: 'auto' })
        .then(result => {
          if (result?.success === false) {
            setStatus(modelStatus, result.error || 'Failed to refresh models.', 'bad')
          }
        })
        .catch(console.error)
    } else if (!canAutoRefresh) {
      setStatus(modelStatus, 'Enter an API key to load models.', null)
    }
  }

  const models = (hasFetchedModels ? extractModelsFromProviderMeta(providerMeta) : [])
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''))

  const query = (modelSearch?.value || '').trim()

  let filteredModels
  if (!query) {
    filteredModels = models
  } else {
    filteredModels = models
      .map(m => ({ model: m, match: scoreModelMatch(m, query) }))
      .filter(x => x.match)
      .sort((a, b) => {
        if (b.match.score !== a.match.score) return b.match.score - a.match.score
        return (a.model.id || '').localeCompare(b.model.id || '')
      })
      .map(x => x.model)
  }

  if (query && filteredModels.length === 0) {
    const q = normalizeSearchText(query)
    const best = models
      .map(m => ({ m, id: normalizeSearchText(m.id), name: normalizeSearchText(m.name) }))
      .map(x => {
        const candidates = [x.id, x.name].filter(Boolean)
        const hit = candidates.some(c => (c.noSpace && q.noSpace && (c.noSpace.includes(q.noSpace) || q.noSpace.includes(c.noSpace))))
        return { model: x.m, hit }
      })
      .find(x => x.hit)?.model

    if (best) {
      setStatus(modelStatus, `No models found. Try: ${best.id}`, null)
    } else {
      setStatus(modelStatus, 'No models found.', null)
    }
  }

  if (selectedModelId) {
    const selectedIndex = filteredModels.findIndex(m => m.id === selectedModelId)
    if (selectedIndex > 0) {
      const [selected] = filteredModels.splice(selectedIndex, 1)
      filteredModels = [selected, ...filteredModels]
    }
  }

  if (modelList) {
    if (!filteredModels.length) {
      if (!hasFetchedModels) return
      modelList.innerHTML = '<div class="status-line">No models found</div>'
      return
    }

    modelList.innerHTML = filteredModels
      .map(m => {
        const isActive = m.id === selectedModelId
        return `
          <div class="model-item ${isActive ? 'active' : ''}" data-model-id="${m.id}">
            <span style="font-size: 13px; font-weight: 500;">${m.id}</span>
            ${isActive ? '<span class="nav-icon" data-icon="check" style="color: var(--accent); width: 14px; height: 14px;"></span>' : ''}
          </div>
        `
      })
      .join('')

    modelList.querySelectorAll('[data-icon="check"]').forEach(el => {
      insertIcon(el, 'check')
    })

    if (selectedModelId && !filteredModels.some(m => m.id === selectedModelId)) {
      setStatus(modelStatus, 'Selected model is filtered out by search.', null)
    } else {
      setStatus(modelStatus, '', null)
    }
  }
}

async function initConfigurationView() {
  const container = document.getElementById('config-content')
  if (!container) return

  const state = await fetchConfigurationState(true)
  renderConfig(container, state)

  const providerSelect = container.querySelector('#config-provider')
  const keyInput = container.querySelector('#config-api-key')
  const keyStatus = container.querySelector('#config-key-status')
  const saveBtn = container.querySelector('#config-key-save')
  const clearBtn = container.querySelector('#config-key-clear')
  const testBtn = container.querySelector('#config-key-test')
  const refreshModelsBtn = container.querySelector('#config-refresh-models')
  const modelSearch = container.querySelector('#config-model-search')
  const modelList = container.querySelector('#config-model-list')
  const modelStatus = container.querySelector('#config-model-status')

  const autoTitleToggle = container.querySelector('#config-auto-title')
  const autoTitleMsg = container.querySelector('#config-auto-title-msg')
  const startCollapsedToggle = container.querySelector('#config-start-collapsed')
  const startCollapsedMsg = container.querySelector('#config-start-collapsed-msg')
  const screenshotModeToggle = container.querySelector('#config-screenshot-mode')
  const screenshotModeMsg = container.querySelector('#config-screenshot-mode-msg')
  const excludeScreenshotsToggle = container.querySelector('#config-exclude-screenshots')
  const excludeScreenshotsMsg = container.querySelector('#config-exclude-screenshots-msg')
  const openDataBtn = container.querySelector('#config-open-data')

  const setAutoTitleMsg = (enabled) => {
    if (!autoTitleMsg) return
    autoTitleMsg.textContent = enabled
      ? 'On: generates a short title automatically.'
      : 'Off: keep the default title until you rename it.'
  }

  const setScreenshotMsg = (isAuto) => {
    if (!screenshotModeMsg) return
    screenshotModeMsg.textContent = isAuto
      ? 'Auto mode: captures and attaches your screen on every send.'
      : 'Manual mode: use the screenshot button / shorcut to attach a screenshot.'
  } 

  const setStartCollapsedMsg = (startCollapsed) => {
    if (!startCollapsedMsg) return
    startCollapsedMsg.textContent = startCollapsed
      ? 'On: overlay starts collapsed.'
      : 'Off: overlay starts expanded.'
  }

  const setExcludeScreenshotsMsg = (exclude) => {
    if (!excludeScreenshotsMsg) return
    excludeScreenshotsMsg.textContent = exclude
      ? 'On: screenshot attachments are not stored in session history.'
      : 'Off: screenshots are stored in session history.'
  }

  const getSelectedProvider = () => providerSelect?.value || state.activeProvider || state.providers?.[0]?.id || ''

  try {
    const [sessionSettingsResult, startCollapsedResult, screenshotModeResult, excludeResult] = await Promise.all([
      window.electronAPI.getSessionSettings(),
      window.electronAPI.getStartCollapsed(),
      window.electronAPI.getScreenshotMode(),
      window.electronAPI.getExcludeScreenshotsFromMemory()
    ])

    const autoTitleEnabled = sessionSettingsResult?.success
      ? sessionSettingsResult.settings?.autoTitleSessions !== false
      : true

    if (autoTitleToggle) {
      autoTitleToggle.checked = autoTitleEnabled
      setAutoTitleMsg(autoTitleEnabled)
    }

    if (startCollapsedToggle) {
      const startCollapsed = startCollapsedResult?.success ? startCollapsedResult.startCollapsed !== false : true
      startCollapsedToggle.checked = startCollapsed
      setStartCollapsedMsg(startCollapsed)
    }

    if (screenshotModeToggle) {
      const mode = screenshotModeResult?.success ? screenshotModeResult.mode : 'manual'
      const isAuto = mode === 'auto'
      screenshotModeToggle.checked = isAuto
      setScreenshotMsg(isAuto)
    }

    if (excludeScreenshotsToggle) {
      const exclude = excludeResult?.success ? excludeResult.exclude !== false : true
      excludeScreenshotsToggle.checked = exclude
      setExcludeScreenshotsMsg(exclude)
    }
  } catch (error) {
    console.error('Failed to load config toggles:', error)
  }

  const setProvider = async (providerId) => {
    if (!providerId) return
    await window.electronAPI.setActiveProvider(providerId)
    cachedActiveProvider = providerId

    setStatus(modelStatus, 'Refreshing models…', null)
    await updateProviderDependentUI(container, providerId)

    const refreshed = await refreshProviderModels(container, providerId, { force: true, reason: 'switch' })
    if (refreshed?.success === false) {
      setStatus(modelStatus, refreshed.error || 'Failed to refresh models.', 'bad')
    }
  }

  providerSelect?.addEventListener('change', async () => {
    await setProvider(providerSelect.value)
  })

  autoTitleToggle?.addEventListener('change', async () => {
    try {
      const enabled = !!autoTitleToggle.checked
      setAutoTitleMsg(enabled)
      await window.electronAPI.setAutoTitleSessions(enabled)
    } catch (error) {
      console.error('Failed to update auto title setting:', error)
    }
  })

  startCollapsedToggle?.addEventListener('change', async () => {
    try {
      const startCollapsed = !!startCollapsedToggle.checked
      setStartCollapsedMsg(startCollapsed)
      await window.electronAPI.setStartCollapsed(startCollapsed)
    } catch (error) {
      console.error('Failed to update start collapsed setting:', error)
    }
  })
 
  screenshotModeToggle?.addEventListener('change', async () => {
    try {
      const isAuto = !!screenshotModeToggle.checked
      setScreenshotMsg(isAuto)
      await window.electronAPI.setScreenshotMode(isAuto ? 'auto' : 'manual')
    } catch (error) {
      console.error('Failed to update screenshot mode:', error)
    }
  })

  excludeScreenshotsToggle?.addEventListener('change', async () => {
    try {
      const exclude = !!excludeScreenshotsToggle.checked
      setExcludeScreenshotsMsg(exclude)
      await window.electronAPI.setExcludeScreenshotsFromMemory(exclude)
    } catch (error) {
      console.error('Failed to update exclude screenshots setting:', error)
    }
  })

  openDataBtn?.addEventListener('click', () => {
    window.electronAPI.openDataFolder?.().catch(console.error)
  })

  const autoTestKey = async () => {
    const providerId = getSelectedProvider()
    const apiKey = (keyInput?.value || '').trim()

    if (!apiKey) {
      setStatus(keyStatus, '', null)
      setStatus(modelStatus, '', null)
      return
    }

    await window.electronAPI.saveApiKey(providerId, apiKey)

    setStatus(keyStatus, 'Testing…', null)
    const result = await window.electronAPI.validateApiKey(providerId)
    if (result?.success) {
      setStatus(keyStatus, result.isValid ? 'Key is valid.' : 'Key is invalid.', result.isValid ? 'good' : 'bad')
      if (result.isValid) {
        setStatus(modelStatus, 'Refreshing models…', null)
        const refreshed = await refreshProviderModels(container, providerId, { force: true, reason: 'key' })
        if (refreshed?.success === false) {
          setStatus(modelStatus, refreshed.error || 'Failed to refresh models.', 'bad')
        }
      }
    } else {
      setStatus(keyStatus, result?.error || 'Failed to validate key.', 'bad')
    }
  }

  let keyAutoTestTimer = null
  let lastAutoTest = { providerId: null, apiKey: null }

  const scheduleAutoTest = () => {
    if (!keyInput) return
    const providerId = getSelectedProvider()
    if (providerId === 'ollama' || providerId === 'lm-studio') return
    const apiKey = (keyInput.value || '').trim()
    if (lastAutoTest.providerId === providerId && lastAutoTest.apiKey === apiKey) return
    if (keyAutoTestTimer) {
      clearTimeout(keyAutoTestTimer)
      keyAutoTestTimer = null
    }
    keyAutoTestTimer = setTimeout(() => {
      lastAutoTest = { providerId, apiKey }
      autoTestKey().catch(console.error)
      keyAutoTestTimer = null
    }, 500)
  }

  keyInput?.addEventListener('paste', () => {
    setTimeout(() => { scheduleAutoTest() }, 0)
  })

  keyInput?.addEventListener('input', () => {
    scheduleAutoTest()
  })

  keyInput?.addEventListener('blur', () => {
    if (!keyInput) return
    if (keyAutoTestTimer) {
      clearTimeout(keyAutoTestTimer)
      keyAutoTestTimer = null
    }
    const providerId = getSelectedProvider()
    if (providerId === 'ollama' || providerId === 'lm-studio') return
    const apiKey = (keyInput.value || '').trim()
    lastAutoTest = { providerId, apiKey }
    autoTestKey().catch(console.error)
  })

  saveBtn?.addEventListener('click', async () => {
    const providerId = getSelectedProvider()
    const apiKey = (keyInput?.value || '').trim()
    await window.electronAPI.saveApiKey(providerId, apiKey)
    setStatus(keyStatus, apiKey ? 'Saved.' : 'Cleared.', apiKey ? 'good' : null)
  })

  clearBtn?.addEventListener('click', async () => {
    const providerId = getSelectedProvider()
    if (keyInput) keyInput.value = ''
    await window.electronAPI.saveApiKey(providerId, '')
    setStatus(keyStatus, 'Cleared.', null)
  })

  testBtn?.addEventListener('click', async () => {
    await autoTestKey()
  })

  refreshModelsBtn?.addEventListener('click', async () => {
    const providerId = getSelectedProvider()
    const result = await window.electronAPI.refreshModels(providerId)
    if (!result?.success) {
      setStatus(modelStatus, result?.error || 'Failed to refresh models.', 'bad')
      return
    }
    cachedProvidersMeta = null
    await fetchConfigurationState(true)
    if (providerSelect) providerSelect.value = providerId
    await updateProviderDependentUI(container, providerId)
    setStatus(modelStatus, 'Models refreshed.', 'good')
  })

  modelSearch?.addEventListener('input', async () => {
    await updateProviderDependentUI(container, getSelectedProvider())
  })

  modelList?.addEventListener('click', async (e) => {
    const item = e.target.closest('.model-item')
    if (!item) return
    const providerId = getSelectedProvider()
    const modelId = item.dataset.modelId
    if (!providerId || !modelId) return
    setStatus(modelStatus, 'Saving…', null)
    const providerConfigResult = await window.electronAPI.getProviderConfig(providerId)
    const providerConfig = providerConfigResult?.success ? (providerConfigResult.config || {}) : {}
    await window.electronAPI.setProviderConfig(providerId, { ...providerConfig, model: modelId })
    setStatus(modelStatus, 'Saved.', 'good')
    await updateProviderDependentUI(container, providerId)
  })

  const initialProvider = getSelectedProvider()
  await updateProviderDependentUI(container, initialProvider)

  // Startup behavior: try to refresh models immediately so we don't show stale defaults.
  setStatus(modelStatus, 'Refreshing models…', null)
  const refreshed = await refreshProviderModels(container, initialProvider, { force: true, reason: 'startup' })
  if (refreshed?.success === false) {
    setStatus(modelStatus, refreshed.error || 'Failed to refresh models.', 'bad')
  }

  // Social links behavior: open in external browser
  container.querySelectorAll('.social-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      const url = link.getAttribute('href')
      if (url && url !== '#') {
        window.electronAPI.openExternal(url)
      }
    })
  })

  // dashboard config icons
  container.querySelectorAll('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon')
    if (name) insertIcon(el, name)
  })

  configViewInitialized = true
}

function wireSocialLinks() {
  // Wire up sidebar social links to open in external browser
  document.querySelectorAll('.sidebar .social-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      const url = link.getAttribute('href')
      if (url && url !== '#') {
        window.electronAPI.openExternal?.(url)
      }
    })
  })
}

function wireNavigation() {
  const navSessions = document.getElementById('nav-sessions')
  const navModes = document.getElementById('nav-modes')
  const navConfiguration = document.getElementById('nav-configuration')
  const navShortcuts = document.getElementById('nav-shortcuts')

  if (navSessions) {
    navSessions.addEventListener('click', async () => {
      // If the user hasn't configured providers yet, keep them on the welcome screen.
      const isFirstRun = await checkFirstRunState()
      if (isFirstRun) {
        showFirstRunExperience()
        return
      }

      navSessions.classList.add('active')
      navModes?.classList.remove('active')
      navConfiguration?.classList.remove('active')
      navShortcuts?.classList.remove('active')
      showView('view-sessions')
      loadSessions().catch(console.error)
    })
  }

  if (navModes) {
    navModes.addEventListener('click', async () => {
      navSessions?.classList.remove('active')
      navConfiguration?.classList.remove('active')
      navShortcuts?.classList.remove('active')
      navModes.classList.add('active')
      showView('view-modes')
      if (!modesViewInitialized) {
        await initModesView()
      }
    })
  }

  if (navConfiguration) {
    navConfiguration.addEventListener('click', async () => {
      navSessions?.classList.remove('active')
      navModes?.classList.remove('active')
      navShortcuts?.classList.remove('active')
      navConfiguration.classList.add('active')
      showView('view-configuration')
      if (!configViewInitialized) {
        await initConfigurationView()
      }
    })
  }

  if (navShortcuts) {
    navShortcuts.addEventListener('click', () => {
      navSessions?.classList.remove('active')
      navModes?.classList.remove('active')
      navConfiguration?.classList.remove('active')
      navShortcuts.classList.add('active')
      showView('view-shortcuts')
    })
  }
}

async function checkFirstRunState() {
  try {
    // 1. Check if we have any sessions at all
    const sessionsResult = await window.electronAPI.getAllSessions()
    const sessions = sessionsResult?.success ? (sessionsResult.sessions || []) : []
    if (sessions.length > 0) {
      return false // User has history, definitely not first run
    }

    // 2. Check for configured cloud providers
    const providersResult = await window.electronAPI.getAllProvidersMeta()
    if (!providersResult?.success) return false

    const providers = normalizeProvidersMeta(providersResult.providers)
    
    for (const provider of providers) {
      // Skip local providers for this check as we want to welcome the user 
      // if they haven't set up cloud keys yet and have no sessions.
      if (provider.id === 'ollama' || provider.id === 'lm-studio') {
        continue
      }
      
      const keyResult = await window.electronAPI.getApiKey(provider.id)
      if (keyResult?.success && keyResult.apiKey && keyResult.apiKey.length > 0) {
        return false // Found a configured cloud provider
      }
    }
    
    // No sessions AND no cloud keys = Show welcome screen
    return true
  } catch (error) {
    console.error('Failed to check first-run state:', error)
    return false
  }
}

function showFirstRunExperience() {
  // Ensure the welcome screen is visible even if user is on another tab
  const navSessions = document.getElementById('nav-sessions')
  const navConfiguration = document.getElementById('nav-configuration')
  const navModes = document.getElementById('nav-modes')
  const navShortcuts = document.getElementById('nav-shortcuts')

  navSessions?.classList.add('active')
  navConfiguration?.classList.remove('active')
  navModes?.classList.remove('active')
  navShortcuts?.classList.remove('active')

  showView('view-first-run')

  const container = document.getElementById('first-run-content')
  if (!container) return

  container.innerHTML = `
    <img src="../../build/appicon.png" alt="Shade Logo" class="welcome-logo" />
    <h1>Welcome to Shade</h1>
    <p>
      Shade makes your screen, smarter. To begin, connect to a cloud provider 
      using an API key or link a local model running on your machine.
    </p>

    <div class="first-run-panel">
      <h3>Quick Setup Options</h3>
      
      <div class="first-run-option">
        <div class="first-run-option-icon">
          <span class="nav-icon" data-icon="website"></span>
        </div>
        <div class="first-run-option-content">
          <div class="first-run-option-title">Cloud Providers</div>
          <div class="first-run-option-desc">Professional models requiring an API key. Fast and powerful.</div>
          <div class="first-run-option-tags">
            <span class="first-run-tag">Gemini</span>
            <span class="first-run-tag">OpenAI</span>
            <span class="first-run-tag">Anthropic</span>
            <span class="first-run-tag">Grok</span>
            <span class="first-run-tag">OpenRouter</span>
          </div>
        </div>
      </div>

      <div class="first-run-option">
        <div class="first-run-option-icon">
          <span class="nav-icon" data-icon="display"></span>
        </div>
        <div class="first-run-option-content">
          <div class="first-run-option-title">Local Providers</div>
          <div class="first-run-option-desc">Private and free models running locally on your hardware.</div>
          <div class="first-run-option-tags">
            <span class="first-run-tag">Ollama</span>
            <span class="first-run-tag">LM Studio</span>
          </div>
        </div>
      </div>
    </div>

    <div style="display: flex; justify-content: center;">
      <button id="first-run-go-to-config" class="action-btn primary" type="button" style="min-width: 240px; height: 44px; font-size: 14px;">
        <span class="nav-icon" data-icon="config"></span>
        Configure AI Provider
      </button>
    </div>
  `

  // Insert icons
  container.querySelectorAll('[data-icon]').forEach(el => {
    insertIcon(el, el.dataset.icon, 'icon-svg')
  })

  const btn = document.getElementById('first-run-go-to-config')
  if (btn) {
    btn.addEventListener('click', () => {
      const navConfigurationEl = document.getElementById('nav-configuration')
      if (navConfigurationEl) {
        navConfigurationEl.click()
      }
    })
  }
}

// Expose to window for testing/debugging
window.showFirstRunExperience = showFirstRunExperience
window.checkFirstRunState = checkFirstRunState

async function init() {
  await initIcons()

  try {
    const versionEl = document.querySelector('.version-text')
    if (versionEl && window.electronAPI?.getAppVersion) {
      const version = await window.electronAPI.getAppVersion()
      if (version) versionEl.textContent = `v${version}`
    }
  } catch (error) {
    console.error('Failed to load app version:', error)
  }

  document.querySelectorAll('[data-icon]').forEach(el => {
    insertIcon(el, el.dataset.icon, el.classList.contains('nav-icon') || el.classList.contains('search-icon') ? undefined : 'icon-svg')
  })

  // Check if this is a first-run experience (no providers configured)
  const isFirstRun = await checkFirstRunState()
  if (isFirstRun) {
    showFirstRunExperience()
    // Still initialize the rest of the UI
  }

  const newChatBtn = document.getElementById('new-chat')
  const savedBtn = document.getElementById('saved-messages')
  const searchInput = document.getElementById('search-input')
  const checkUpdateBtn = document.getElementById('check-update')
  const reportBugBtn = document.getElementById('report-bug')
  const quitBtn = document.getElementById('quit-shade')
  const minimizeBtn = document.getElementById('dashboard-minimize')
  const closeBtn = document.getElementById('dashboard-close')
  const sessionsDeleteAllBtn = document.getElementById('sessions-delete-all')
  const deleteAllDataModal = document.getElementById('delete-all-data-modal')
  const deleteAllDataConfirm = document.getElementById('delete-all-data-confirm')
  const deleteAllDataCancel = document.getElementById('delete-all-data-cancel')

  const deleteSessionsModal = document.getElementById('delete-sessions-modal')
  const deleteSessionsConfirm = document.getElementById('delete-sessions-confirm')
  const deleteSessionsCancel = document.getElementById('delete-sessions-cancel')

  const deleteModeModal = document.getElementById('delete-mode-modal')
  const deleteModeConfirm = document.getElementById('delete-mode-confirm')
  const deleteModeCancel = document.getElementById('delete-mode-cancel')

  newChatBtn?.addEventListener('click', handleNewChat)
  
  savedBtn?.addEventListener('click', () => {
    showingSaved = !showingSaved
    if (savedBtn) {
      savedBtn.innerHTML = `<span class="nav-icon" data-icon="save"></span> ${showingSaved ? 'All Chats' : 'Saved'}`
      insertIcon(savedBtn.querySelector('.nav-icon'), 'save')
      if (showingSaved) {
        savedBtn.classList.add('active')
      } else {
        savedBtn.classList.remove('active')
      }
    }
    const searchInput = document.getElementById('search-input')
    if (searchInput) {
      searchInput.value = ''
    }
    loadSessions().catch(console.error)
  })

  minimizeBtn?.addEventListener('click', () => window.electronAPI.minimizeDashboard?.())
  closeBtn?.addEventListener('click', () => window.electronAPI.closeDashboard?.())

  sessionsDeleteAllBtn?.addEventListener('click', () => {
    deleteAllDataModal?.classList.add('open')
    const iconSpan = deleteAllDataModal?.querySelector('[data-icon="trash"]')
    if (iconSpan) insertIcon(iconSpan, 'trash')
  })

  deleteAllDataCancel?.addEventListener('click', () => {
    deleteAllDataModal?.classList.remove('open')
  })

  deleteAllDataConfirm?.addEventListener('click', async () => {
    try {
      deleteAllDataConfirm.disabled = true
      deleteAllDataConfirm.textContent = 'Deleting...'

      const result = await window.electronAPI.deleteAllData?.()

      if (result?.success) {
        showToast('All data deleted', 'success')
        // Refresh UI state
        cachedModes = null
        cachedProvidersMeta = null
        cachedActiveProvider = null
        await loadSessions().catch(console.error)
      } else {
        showToast(result?.error || 'Failed to delete data', 'error')
      }

      deleteAllDataModal?.classList.remove('open')
    } catch (error) {
      console.error('Failed to delete all data:', error)
      showToast('Error deleting data', 'error')
    } finally {
      deleteAllDataConfirm.disabled = false
      deleteAllDataConfirm.textContent = 'Delete Everything'
    }
  })

  deleteSessionsCancel?.addEventListener('click', () => {
    deleteSessionsModal?.classList.remove('open')
  })

  deleteSessionsConfirm?.addEventListener('click', async () => {
    try {
      deleteSessionsConfirm.disabled = true
      deleteSessionsConfirm.textContent = 'Deleting...'

      for (const id of selectedSessionIds) {
        await window.electronAPI.deleteSession(id)
      }
      
      selectedSessionIds.clear()
      updateBulkModeUI()
      await loadSessions()
      
      deleteSessionsModal?.classList.remove('open')
    } catch (error) {
      console.error('Failed to delete sessions:', error)
      showToast('Error deleting conversations', 'error')
    } finally {
      deleteSessionsConfirm.disabled = false
      deleteSessionsConfirm.textContent = 'Delete'
    }
  })

  deleteModeCancel?.addEventListener('click', () => {
    deleteModeModal?.classList.remove('open')
    selectedModeIdToDelete = null
  })

  deleteModeConfirm?.addEventListener('click', async () => {
    if (!selectedModeIdToDelete) return
    try {
      deleteModeConfirm.disabled = true
      deleteModeConfirm.textContent = 'Deleting...'

      await window.electronAPI.deleteMode(selectedModeIdToDelete)
      cachedModes = null
      const s = await fetchModesState(true)
      if (selectedModeId === selectedModeIdToDelete) selectedModeId = s.activeModeId
      
      const listEl = document.getElementById('modes-list')
      const editorEl = document.getElementById('mode-editor')
      if (listEl) renderModesList(listEl, s)
      if (editorEl) await renderModeEditor(editorEl, s)

      deleteModeModal?.classList.remove('open')
    } catch (error) {
      console.error('Failed to delete mode:', error)
      showToast('Error deleting mode', 'error')
    } finally {
      deleteModeConfirm.disabled = false
      deleteModeConfirm.textContent = 'Delete Mode'
      selectedModeIdToDelete = null
    }
  })

  searchInput?.addEventListener('input', (e) => {
    const value = e.target.value
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
    searchTimer = setTimeout(() => {
      loadSessions(value).catch(console.error)
      searchTimer = null
    }, 180)
  })

  checkUpdateBtn?.addEventListener('click', async () => {
    try {
      const result = await window.electronAPI.checkForUpdates()
      if (result.updateAvailable) {
        showToast(`Update available: v${result.version}`, 'info', 5000)
       } else {
         showToast('You are running the latest version.', 'info')
       }
    } catch (error) {
      console.error('Update check failed:', error)
      showToast('Failed to check for updates. Please try again later.', 'error')
    }
  })

  reportBugBtn?.addEventListener('click', () => {
    showToast('Bug reporter coming soon. Open an issue on GitHub.', 'info')
  })

  quitBtn?.addEventListener('click', async () => {
    await window.electronAPI.quitApp?.()
  })

  window.electronAPI.onNewChat(() => {
    handleNewChat().catch(console.error)
  })

  // Keep Configuration view in sync when model changes elsewhere (e.g. model switcher)
  window.electronAPI.onConfigChanged(async () => {
    try {
      cachedProvidersMeta = null
      cachedActiveProvider = null

      if (!configViewInitialized) return

      const container = document.getElementById('config-content')
      if (!container) return

      const state = await fetchConfigurationState(true)

      const providerSelect = container.querySelector('#config-provider')
      const providerId = providerSelect?.value || state.activeProvider || state.providers?.[0]?.id || ''

      if (providerSelect && state.activeProvider) {
        providerSelect.value = state.activeProvider
      }

      if (providerId) {
        await updateProviderDependentUI(container, providerId)
      }
    } catch (error) {
      console.error('Failed to refresh config view:', error)
    }
  })

  const renameModal = document.getElementById('rename-modal')
  const renameInput = document.getElementById('rename-input')
  const renameCancel = document.getElementById('rename-cancel')
  const renameSave = document.getElementById('rename-save')

  renameCancel?.addEventListener('click', closeRenameModal)
  renameSave?.addEventListener('click', () => submitRenameModal().catch(console.error))

  deleteAllDataModal?.addEventListener('click', (e) => {
    if (e.target === deleteAllDataModal) {
      deleteAllDataModal.classList.remove('open')
    }
  })

  deleteSessionsModal?.addEventListener('click', (e) => {
    if (e.target === deleteSessionsModal) {
      deleteSessionsModal.classList.remove('open')
    }
  })

  deleteModeModal?.addEventListener('click', (e) => {
    if (e.target === deleteModeModal) {
      deleteModeModal.classList.remove('open')
      selectedModeIdToDelete = null
    }
  })

  renameModal?.addEventListener('click', (e) => {
    if (e.target === renameModal) {
      closeRenameModal()
    }
  })

  renameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeRenameModal()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      submitRenameModal().catch(console.error)
    }
  })

  window.electronAPI.onContextMenuCommand(({ command, sessionId }) => {
    if (command === 'delete') {
      handleDeleteSession(sessionId)
    } else if (command === 'rename') {
      handleRenameSession(sessionId)
    } else if (command === 'save') {
      handleToggleSaved(sessionId)
    }
  })

  wireNavigation()
  wireSocialLinks()
  loadSessions().catch(console.error)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
