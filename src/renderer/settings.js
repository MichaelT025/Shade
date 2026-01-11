/**
 * Shade Settings Window
 * Handles provider configuration, API keys, and preferences
 */

import { initIcons, insertIcon } from './assets/icons/icons.js';

// Default system prompt for screenshot analysis
const DEFAULT_SYSTEM_PROMPT = `
You're Shade, a real time assistant that gives short precise answers. 
You respond naturally, like a sharp human who knows the topic well.

Style:
Keep responses brief and direct, usually one or two sentences. 
If longer is needed, use simple bullet points. 
Never add filler, preambles, meta comments or restatements of the question. 
Use a normal conversational tone, use contractions, and avoid corporate or robotic phrasing.

Math and code:
When writing math, always use LaTeX with explicit delimiters so it can be rendered.
Use any of these standard formats:
- Inline math: $x^2$ or \\(x^2\\)
- Block/display math: $$\\int_0^1 x^2\\,dx$$ or \\[\\int_0^1 x^2\\,dx\\]

Do NOT write bare LaTeX without delimiters.
Do NOT put math inside fenced code blocks unless explicitly asked for raw LaTeX.

When code is needed, output complete working code with clear comments.
Explain only what's required to solve the user's request.

Emails:
Write emails in a natural human voice that matches the user's style. 
Keep them concise and avoid stiff formal language. 
Don't use generic AI sounding phrasing.

Uncertainty:
If you're unsure about something, say so briefly and ask a clarifying question. 
Never guess or state uncertain information confidently.

Constraints:
Do not give the user scripts or exact word tracks for meetings. 
Do not end responses with questions unless asking for clarification due to uncertainty. 
Stay accurate and grounded at all times.

Memory:
Use the recent messages to maintain coherent context.
`

// Current settings state
let currentSettings = {
  activeProvider: 'gemini',
  providers: {}, // Dynamic provider configs
  historyLimit: 10,
  primaryDisplay: 0,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  modes: [],
  selectedMode: 'default'
}

// Provider metadata from registry (loaded dynamically)
let providerRegistry = {}

/**
 * Load provider metadata from registry
 */
async function loadProviderMetadata() {
  try {
    const result = await window.electronAPI.getAllProvidersMeta()
    if (result.success) {
      providerRegistry = result.providers
      return true
    } else {
      console.error('Failed to load provider metadata:', result.error)
      return false
    }
  } catch (error) {
    console.error('Error loading provider metadata:', error)
    return false
  }
}

/**
 * Populate provider dropdown from registry
 */
function populateProviderDropdown() {
  const providerSelect = document.getElementById('provider-select')
  if (!providerSelect) return
  providerSelect.innerHTML = '' // Clear existing options

  // Add option for each provider in registry
  for (const [providerId, provider] of Object.entries(providerRegistry)) {
    const option = document.createElement('option')
    option.value = providerId
    option.textContent = provider.name
    providerSelect.appendChild(option)
  }
}

/**
 * Generate provider sections dynamically from registry
 */
function generateProviderSections() {
  const container = document.getElementById('provider-sections-container')
  if (!container) return
  container.innerHTML = '' // Clear existing content

  // Generate section for each provider in registry
  for (const [providerId, provider] of Object.entries(providerRegistry)) {
    const section = document.createElement('div')
    section.className = 'section'
    section.id = `${providerId}-section`
    section.style.display = currentSettings.activeProvider === providerId ? 'block' : 'none'

    // Generate models list instead of dropdown
    const modelsListHtml = provider.models && Object.keys(provider.models).length > 0
      ? `<div id="${providerId}-model-list" class="model-list">
          ${Object.entries(provider.models).map(([modelId, modelMeta]) => {
            const isActive = currentSettings.providers[providerId]?.model === modelId
            return `
              <div class="model-item ${isActive ? 'active' : ''}" data-model-id="${modelId}" onclick="window.selectModel('${providerId}', '${modelId}')">
                <span style="font-size: 13px; font-weight: 500;">${modelMeta.name || modelId}</span>
                ${isActive ? '<span class="nav-icon" data-icon="check" style="color: var(--accent); width: 14px; height: 14px;"></span>' : ''}
              </div>
            `
          }).join('')}
        </div>`
      : `<input type="text" id="${providerId}-model" placeholder="Enter model name">`

    // Generate section HTML
    section.innerHTML = `
      <div class="section-title">${provider.name} Configuration</div>

      <div class="form-group">
        <label for="${providerId}-api-key">API Key</label>
        <div class="form-description">Get your API key from <a href="${provider.website}" target="_blank" style="color: var(--accent);">${provider.name}</a></div>
        <div class="api-key-input-wrapper">
          <input type="password" id="${providerId}-api-key" placeholder="Enter your ${provider.name} API key">
          <button class="toggle-visibility" onclick="window.togglePasswordVisibility('${providerId}-api-key')">Show</button>
        </div>
      </div>

       <div class="form-group">
         <label>Model</label>
         <div id="${providerId}-refresh-status" class="status-message" style="margin-top: 4px; margin-bottom: 8px;"></div>
         ${modelsListHtml}
         <div style="font-size: 11px; color: rgba(255, 255, 255, 0.5); margin-top: 6px;">
           Note: Some models don't support screenshots and some models might not work with this application.
         </div>
         <button class="btn-refresh-models" onclick="window.refreshProviderModels('${providerId}')" style="margin-top: 8px;">
           <span class="refresh-icon">↻</span> Refresh Models
         </button>
       </div>

      ${provider.baseUrl ? `
        <div class="form-group">
          <label for="${providerId}-baseurl">Base URL</label>
          <input type="text" id="${providerId}-baseurl" placeholder="${provider.baseUrl}">
        </div>
      ` : ''}

      <button class="btn-test" onclick="window.testProvider('${providerId}')">Test Connection</button>
      <div id="${providerId}-status" class="status-message"></div>
    `

    container.appendChild(section)
  }
}

/**
 * Initialize settings window
 */
async function init() {
  console.log('Initializing settings window...')

  // Initialize custom icons
  await initIcons()

  // Load provider metadata from registry
  const metadataLoaded = await loadProviderMetadata()
  if (!metadataLoaded) {
    showStatus('save-status', 'Failed to load provider metadata', 'error')
    return
  }

  // Populate provider dropdown from registry
  populateProviderDropdown()

  // Generate provider sections dynamically
  generateProviderSections()

  // Load current settings
  await loadSettings()

  // Load available displays
  await loadDisplays()

  // Load modes
  await loadModes()

  // Set up event listeners
  setupEventListeners()

  // Listen for reload-settings event (when window is refocused)
  window.electronAPI.onReloadSettings(async () => {
    console.log('Reloading settings...')
    await loadSettings()
    await loadDisplays()
    await loadModes()
    updateProviderUI()
  })

  // Update UI to match current provider
  updateProviderUI()

  console.log('Settings initialized')
}

/**
 * Load current settings from main process
 */
async function loadSettings() {
  try {
    const activeProviderResult = await window.electronAPI.getActiveProvider()
    const firstProvider = Object.keys(providerRegistry)[0] || 'gemini'
    const activeProvider = activeProviderResult.provider || firstProvider
    currentSettings.activeProvider = activeProvider

    for (const providerId of Object.keys(providerRegistry)) {
      const keyResult = await window.electronAPI.getApiKey(providerId)
      const apiKey = keyResult.apiKey || ''

      const configResult = await window.electronAPI.getProviderConfig(providerId)
      const config = configResult.config || {}

      if (!currentSettings.providers[providerId]) {
        currentSettings.providers[providerId] = {}
      }
      currentSettings.providers[providerId].apiKey = apiKey
      currentSettings.providers[providerId].model = config.model || providerRegistry[providerId].defaultModel
      currentSettings.providers[providerId].baseUrl = config.baseUrl || ''

      const apiKeyField = document.getElementById(`${providerId}-api-key`)
      const modelField = document.getElementById(`${providerId}-model`)
      const baseUrlField = document.getElementById(`${providerId}-baseurl`)

      if (apiKeyField) apiKeyField.value = apiKey
      if (modelField) {
        modelField.value = currentSettings.providers[providerId].model
      } else {
        selectModel(providerId, currentSettings.providers[providerId].model)
      }
      if (baseUrlField) baseUrlField.value = currentSettings.providers[providerId].baseUrl
    }

    const activeConfig = currentSettings.providers[activeProvider] || {}
    currentSettings.systemPrompt = activeConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT

    document.getElementById('provider-select').value = activeProvider
    document.getElementById('system-prompt').value = currentSettings.systemPrompt

    const memorySettingsResult = await window.electronAPI.getMemorySettings()
    if (memorySettingsResult.success) {
      currentSettings.historyLimit = memorySettingsResult.settings.historyLimit || 10
      document.getElementById('history-limit').value = currentSettings.historyLimit
    }
  } catch (error) {
    console.error('Failed to load settings:', error)
    showStatus('save-status', 'Failed to load settings', 'error')
  }
}

/**
 * Load available displays
 */
async function loadDisplays() {
  try {
    const result = await window.electronAPI.getDisplays()
    const displays = result.displays || []
    const displaySelect = document.getElementById('display-select')
    if (!displaySelect) return

    displaySelect.innerHTML = ''
    displays.forEach((display, index) => {
      const option = document.createElement('option')
      option.value = index
      option.textContent = `Display ${index + 1}${display.primary ? ' (Primary)' : ''} - ${display.width}x${display.height}`
      displaySelect.appendChild(option)
    })

    const primaryIndex = displays.findIndex(d => d.primary)
    if (primaryIndex !== -1) {
      displaySelect.value = primaryIndex
      currentSettings.primaryDisplay = primaryIndex
    }
  } catch (error) {
    console.error('Failed to load displays:', error)
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  const providerSelect = document.getElementById('provider-select')
  providerSelect?.addEventListener('change', (e) => {
    currentSettings.activeProvider = e.target.value
    updateProviderUI()
  })

  const displaySelect = document.getElementById('display-select')
  displaySelect?.addEventListener('change', (e) => {
    currentSettings.primaryDisplay = parseInt(e.target.value)
  })

  const timeouts = {}
  for (const providerId of Object.keys(providerRegistry)) {
    const apiKeyField = document.getElementById(`${providerId}-api-key`)
    if (apiKeyField) {
      apiKeyField.addEventListener('input', (e) => {
        clearTimeout(timeouts[providerId])
        const apiKey = e.target.value.trim()
        if (apiKey.length > 10) {
          timeouts[providerId] = setTimeout(async () => {
            if (!currentSettings.providers[providerId]) {
              currentSettings.providers[providerId] = {}
            }
            currentSettings.providers[providerId].apiKey = apiKey
            await window.electronAPI.saveApiKey(providerId, apiKey)
            testProvider(providerId)
          }, 1000)
        }
      })
    }

    const modelField = document.getElementById(`${providerId}-model`)
    if (modelField) {
      modelField.addEventListener('change', (e) => {
        if (!currentSettings.providers[providerId]) {
          currentSettings.providers[providerId] = {}
        }
        currentSettings.providers[providerId].model = e.target.value
      })
    }

    const baseUrlField = document.getElementById(`${providerId}-baseurl`)
    if (baseUrlField) {
      baseUrlField.addEventListener('input', (e) => {
        if (!currentSettings.providers[providerId]) {
          currentSettings.providers[providerId] = {}
        }
        currentSettings.providers[providerId].baseUrl = e.target.value.trim()
      })
    }
  }

  document.getElementById('mode-select')?.addEventListener('change', (e) => {
    currentSettings.selectedMode = e.target.value
    updateModeUI()
  })
}

/**
 * Select a model for a provider
 */
function selectModel(providerId, modelId) {
  if (!currentSettings.providers[providerId]) {
    currentSettings.providers[providerId] = {}
  }
  currentSettings.providers[providerId].model = modelId

  const list = document.getElementById(`${providerId}-model-list`)
  if (list) {
    list.querySelectorAll('.model-item').forEach(el => {
      el.classList.remove('active')
      const check = el.querySelector('[data-icon="check"]')
      if (check) check.remove()
    })

    const selectedItem = list.querySelector(`.model-item[data-model-id="${modelId}"]`)
    if (selectedItem) {
      selectedItem.classList.add('active')
      const check = document.createElement('span')
      check.className = 'nav-icon'
      check.dataset.icon = 'check'
      check.style.color = 'var(--accent)'
      check.style.width = '16px'
      check.style.height = '16px'
      selectedItem.appendChild(check)
      initIcons()
    }
  }
}

window.selectModel = selectModel

/**
 * Update UI based on selected provider
 */
function updateProviderUI() {
  const provider = currentSettings.activeProvider

  for (const providerId of Object.keys(providerRegistry)) {
    const section = document.getElementById(`${providerId}-section`)
    if (section) {
      section.style.display = 'none'
    }
  }

  const activeSection = document.getElementById(`${provider}-section`)
  if (activeSection) {
    activeSection.style.display = 'block'
  }

  const providerInfoEl = document.getElementById('current-provider-info')
  if (providerInfoEl && providerRegistry[provider]) {
    const providerMeta = providerRegistry[provider]
    const hasApiKey = currentSettings.providers[provider]?.apiKey?.length > 0
    const badge = hasApiKey ? 'Active' : 'Configure'

    providerInfoEl.innerHTML = `
      <div class="provider-details">
        <div class="provider-name">${providerMeta.name} <span class="provider-badge ${hasApiKey ? 'active' : ''}">${badge}</span></div>
        <div class="provider-status">${providerMeta.description}</div>
      </div>
    `
  }
}

/**
 * Toggle password visibility
 */
function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId)
  if (!input) return
  const button = input.nextElementSibling

  if (input.type === 'password') {
    input.type = 'text'
    if (button) button.textContent = 'Hide'
  } else {
    input.type = 'password'
    if (button) button.textContent = 'Show'
  }
}

window.togglePasswordVisibility = togglePasswordVisibility

/**
 * Test provider connection
 */
async function testProvider(provider) {
  const statusEl = document.getElementById(`${provider}-status`)
  const apiKeyInput = document.getElementById(`${provider}-api-key`)
  const apiKey = apiKeyInput ? apiKeyInput.value.trim() : ''

  if (!apiKey && provider !== 'custom' && provider !== 'ollama' && provider !== 'lm-studio') {
    showStatus(`${provider}-status`, 'Please enter an API key first', 'error')
    return
  }

  try {
    if (statusEl) {
      statusEl.className = 'status-message'
      statusEl.style.display = 'block'
      statusEl.style.background = 'rgba(182, 179, 180, 0.14)'
      statusEl.style.borderColor = 'rgba(182, 179, 180, 0.28)'
      statusEl.style.color = '#d7d4d5'
      statusEl.textContent = 'Testing connection...'
    }

    const result = await window.electronAPI.validateApiKey(provider)
    if (result.isValid) {
      showStatus(`${provider}-status`, `✓ Connection successful!`, 'success')
    } else {
      showStatus(`${provider}-status`, `✗ Invalid API key: ${result.error || 'Authentication failed'}`, 'error')
    }
  } catch (error) {
    console.error('Test provider error:', error)
    showStatus(`${provider}-status`, `✗ Connection failed: ${error.message}`, 'error')
  }
}

window.testProvider = testProvider

/**
 * Save settings
 */
async function saveSettings() {
  try {
    const activeProvider = document.getElementById('provider-select').value
    const systemPrompt = document.getElementById('system-prompt').value.trim() || DEFAULT_SYSTEM_PROMPT

    for (const providerId of Object.keys(providerRegistry)) {
      const apiKeyField = document.getElementById(`${providerId}-api-key`)
      const modelField = document.getElementById(`${providerId}-model`)
      const baseUrlField = document.getElementById(`${providerId}-baseurl`)

      const apiKey = apiKeyField ? apiKeyField.value.trim() : ''
      const model = modelField ? modelField.value : currentSettings.providers[providerId].model
      const baseUrl = baseUrlField ? baseUrlField.value.trim() : ''

      if (providerId === activeProvider && !apiKey && providerId !== 'custom' && providerId !== 'ollama' && providerId !== 'lm-studio') {
        const providerName = providerRegistry[providerId].name
        showStatus('save-status', `Please enter a ${providerName} API key`, 'error')
        return
      }

      if (apiKey) {
        await window.electronAPI.saveApiKey(providerId, apiKey)
      }

      const config = { model, systemPrompt }
      if (baseUrl) config.baseUrl = baseUrl
      await window.electronAPI.setProviderConfig(providerId, config)
    }

    await window.electronAPI.setActiveProvider(activeProvider)
    showStatus('save-status', '✓ Settings saved successfully!', 'success')
    setTimeout(() => window.close(), 1500)
  } catch (error) {
    console.error('Save settings error:', error)
    showStatus('save-status', `Failed to save settings: ${error.message}`, 'error')
  }
}

window.saveSettings = saveSettings

/**
 * Close settings window
 */
function closeSettings() {
  window.close()
}

window.closeSettings = closeSettings

/**
 * Show status message
 */
function showStatus(elementId, message, type) {
  const statusEl = document.getElementById(elementId)
  if (!statusEl) return
  statusEl.textContent = message
  statusEl.className = `status-message ${type}`
  statusEl.style.display = 'block'
}

/**
 * Load modes from config
 */
async function loadModes() {
  try {
    const result = await window.electronAPI.getModes()
    const modes = result.modes || []
    const activeModeResult = await window.electronAPI.getActiveMode()
    const activeModeId = activeModeResult.modeId || 'default'

    currentSettings.modes = modes
    currentSettings.selectedMode = activeModeId

    const modeSelect = document.getElementById('mode-select')
    if (!modeSelect) return
    modeSelect.innerHTML = ''

    modes.forEach(mode => {
      const option = document.createElement('option')
      option.value = mode.id
      option.textContent = mode.name
      modeSelect.appendChild(option)
    })

    modeSelect.value = activeModeId
    updateModeUI()
  } catch (error) {
    console.error('Failed to load modes:', error)
  }
}

/**
 * Update mode UI based on selected mode
 */
function updateModeUI() {
  const selectedModeId = currentSettings.selectedMode
  const mode = currentSettings.modes.find(m => m.id === selectedModeId)
  if (!mode) return

  const modeNameContainer = document.getElementById('mode-name-container')
  const modeNameInput = document.getElementById('mode-name')
  const deleteBtn = document.getElementById('delete-mode-btn')

  if (mode.isDefault) {
    if (modeNameContainer) modeNameContainer.style.display = 'none'
    if (deleteBtn) deleteBtn.disabled = true
    if (modeNameInput) modeNameInput.value = ''
  } else {
    if (modeNameContainer) modeNameContainer.style.display = 'block'
    if (deleteBtn) deleteBtn.disabled = false
    if (modeNameInput) modeNameInput.value = mode.name
  }

  const promptField = document.getElementById('system-prompt')
  if (promptField) promptField.value = mode.prompt || ''
}

/**
 * Create a new mode
 */
function createNewMode() {
  const newId = 'mode-' + Date.now()
  const newMode = {
    id: newId,
    name: 'New Mode',
    prompt: DEFAULT_SYSTEM_PROMPT,
    isDefault: false
  }

  currentSettings.modes.push(newMode)
  const modeSelect = document.getElementById('mode-select')
  if (modeSelect) {
    const option = document.createElement('option')
    option.value = newMode.id
    option.textContent = newMode.name
    modeSelect.appendChild(option)
    modeSelect.value = newId
  }
  
  currentSettings.selectedMode = newId
  updateModeUI()
  document.getElementById('mode-name')?.focus()
}

window.createNewMode = createNewMode

/**
 * Delete the currently selected mode
 */
async function deleteMode() {
  const modeId = currentSettings.selectedMode
  if (modeId === 'default') return

  const modal = document.getElementById('delete-mode-modal')
  const confirmBtn = document.getElementById('confirm-delete-mode-btn')
  const iconSpan = document.getElementById('modal-trash-icon')
  
  if (iconSpan) insertIcon(iconSpan, 'trash')
  
  modal?.classList.add('open')

  // Remove existing listener if any
  const newConfirmBtn = confirmBtn.cloneNode(true)
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn)

  newConfirmBtn.addEventListener('click', async () => {
    try {
      newConfirmBtn.disabled = true
      newConfirmBtn.textContent = 'Deleting...'
      
      await window.electronAPI.deleteMode(modeId)
      currentSettings.modes = currentSettings.modes.filter(m => m.id !== modeId)
      const modeSelect = document.getElementById('mode-select')
      if (modeSelect) {
        modeSelect.querySelector(`option[value="${modeId}"]`)?.remove()
        modeSelect.value = 'default'
      }
      currentSettings.selectedMode = 'default'
      updateModeUI()
      showStatus('mode-save-status', 'Mode deleted successfully', 'success')
      
      closeDeleteModeModal()
      
      setTimeout(() => {
        const el = document.getElementById('mode-save-status')
        if (el) el.style.display = 'none'
      }, 2000)
    } catch (error) {
      console.error('Failed to delete mode:', error)
      showStatus('mode-save-status', 'Failed to delete mode: ' + error.message, 'error')
      newConfirmBtn.disabled = false
      newConfirmBtn.textContent = 'Delete Mode'
    }
  })
}

function closeDeleteModeModal() {
  const modal = document.getElementById('delete-mode-modal')
  modal?.classList.remove('open')
}

window.closeDeleteModeModal = closeDeleteModeModal
window.deleteMode = deleteMode

/**
 * Save memory settings
 */
async function saveMemorySettings() {
  try {
    const historyLimit = parseInt(document.getElementById('history-limit').value)
    if (isNaN(historyLimit) || historyLimit < 5 || historyLimit > 50) {
      showStatus('memory-status', 'Please enter a valid number between 5 and 50', 'error')
      return
    }

    await window.electronAPI.setHistoryLimit(historyLimit)
    currentSettings.historyLimit = historyLimit
    showStatus('memory-status', 'Memory settings saved successfully!', 'success')
    setTimeout(() => {
      const el = document.getElementById('memory-status')
      if (el) el.style.display = 'none'
    }, 2000)
  } catch (error) {
    console.error('Failed to save memory settings:', error)
    showStatus('memory-status', 'Failed to save settings: ' + error.message, 'error')
  }
}

window.saveMemorySettings = saveMemorySettings

/**
 * Save the currently selected mode
 */
async function saveCurrentMode() {
  const modeId = currentSettings.selectedMode
  const mode = currentSettings.modes.find(m => m.id === modeId)
  if (!mode) return

  const prompt = document.getElementById('system-prompt').value.trim()
  const name = mode.isDefault ? 'Default' : document.getElementById('mode-name').value.trim()

  if (!name) {
    showStatus('mode-save-status', 'Please enter a mode name', 'error')
    return
  }
  if (!prompt) {
    showStatus('mode-save-status', 'Please enter a system prompt', 'error')
    return
  }

  mode.name = name
  mode.prompt = prompt

  try {
    await window.electronAPI.saveMode(mode)
    const modeSelect = document.getElementById('mode-select')
    if (modeSelect) {
      const option = modeSelect.querySelector(`option[value="${modeId}"]`)
      if (option) option.textContent = name
    }
    showStatus('mode-save-status', 'Mode saved successfully!', 'success')
    setTimeout(() => {
      const el = document.getElementById('mode-save-status')
      if (el) el.style.display = 'none'
    }, 2000)
  } catch (error) {
    console.error('Failed to save mode:', error)
    showStatus('mode-save-status', 'Failed to save mode: ' + error.message, 'error')
  }
}

window.saveCurrentMode = saveCurrentMode

/**
 * Refresh models for a provider
 */
async function refreshProviderModels(providerId) {
  const statusElement = document.getElementById(`${providerId}-refresh-status`)
  const button = event?.target?.closest('.btn-refresh-models')

  try {
    if (button) {
      button.disabled = true
      button.innerHTML = '<span class="refresh-icon">↻</span> Refreshing...'
    }
    if (statusElement) {
      statusElement.textContent = 'Fetching models...'
      statusElement.style.display = 'block'
    }

    const keyResult = await window.electronAPI.getApiKey(providerId)
    const apiKey = keyResult.apiKey || ''
    const result = await window.electronAPI.refreshModels(providerId, apiKey)

    if (result.success) {
      await loadProviderMetadata()
      generateProviderSections()
      await loadSettings()
      updateProviderUI()
      
      const newStatus = document.getElementById(`${providerId}-refresh-status`)
      if (newStatus) {
        newStatus.textContent = `✓ Refreshed ${Object.keys(result.models).length} models`
        newStatus.className = 'status-message success'
        setTimeout(() => newStatus.style.display = 'none', 3000)
      }
    } else {
      if (statusElement) {
        statusElement.textContent = `✗ ${result.error}`
        statusElement.className = 'status-message error'
        setTimeout(() => statusElement.style.display = 'none', 5000)
      }
      if (button) {
        button.disabled = false
        button.innerHTML = '<span class="refresh-icon">↻</span> Refresh Models'
      }
    }
  } catch (error) {
    console.error('Failed to refresh models:', error)
    if (statusElement) {
      statusElement.textContent = `✗ ${error.message}`
      statusElement.className = 'status-message error'
      setTimeout(() => statusElement.style.display = 'none', 5000)
    }
    if (button) {
      button.disabled = false
      button.innerHTML = '<span class="refresh-icon">↻</span> Refresh Models'
    }
  }
}

window.refreshProviderModels = refreshProviderModels

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
