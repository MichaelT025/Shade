/**
 * Shade Settings Window
 * Handles provider configuration, API keys, and preferences
 */

import { getIcon, initIcons } from './assets/icons/icons.js';

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
      console.log('Provider metadata loaded:', Object.keys(providerRegistry))
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
  providerSelect.innerHTML = '' // Clear existing options

  // Add option for each provider in registry
  for (const [providerId, provider] of Object.entries(providerRegistry)) {
    const option = document.createElement('option')
    option.value = providerId
    option.textContent = provider.name
    providerSelect.appendChild(option)
  }

  console.log('Provider dropdown populated with', Object.keys(providerRegistry).length, 'providers')
}

/**
 * Generate provider sections dynamically from registry
 */
function generateProviderSections() {
  const container = document.getElementById('provider-sections-container')
  container.innerHTML = '' // Clear existing content

  // Generate section for each provider in registry
  for (const [providerId, provider] of Object.entries(providerRegistry)) {
    const section = document.createElement('div')
    section.className = 'section'
    section.id = `${providerId}-section`
    section.style.display = currentSettings.activeProvider === providerId ? 'block' : 'none'

    // Generate models dropdown options from models object
    const modelOptions = provider.models && Object.keys(provider.models).length > 0
      ? Object.entries(provider.models).map(([modelId, modelMeta]) =>
          `<option value="${modelId}">${modelMeta.name}</option>`
        ).join('')
      : '<option value="">Enter custom model</option>'

    // Generate section HTML
    section.innerHTML = `
      <div class="section-title">${provider.name} Configuration</div>

      <div class="form-group">
        <label for="${providerId}-api-key">API Key</label>
        <div class="form-description">Get your API key from <a href="${provider.website}" target="_blank" style="color: var(--accent);">${provider.name}</a></div>
        <div class="api-key-input-wrapper">
          <input type="password" id="${providerId}-api-key" placeholder="Enter your ${provider.name} API key">
          <button class="toggle-visibility" onclick="togglePasswordVisibility('${providerId}-api-key')">Show</button>
        </div>
      </div>

      <div class="form-group">
        <label for="${providerId}-model">Model</label>
        ${provider.models && Object.keys(provider.models).length > 0 ? `
          <select id="${providerId}-model">
            ${modelOptions}
          </select>
        ` : `
          <input type="text" id="${providerId}-model" placeholder="Enter model name">
        `}
      </div>

      ${provider.baseUrl ? `
        <div class="form-group">
          <label for="${providerId}-baseurl">Base URL</label>
          <input type="text" id="${providerId}-baseurl" placeholder="${provider.baseUrl}">
        </div>
      ` : ''}

      <button class="btn-test" onclick="testProvider('${providerId}')">Test Connection</button>
      <div id="${providerId}-status" class="status-message"></div>
    `

    container.appendChild(section)
  }

  console.log('Provider sections generated')
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
    // Get active provider
    const activeProviderResult = await window.electronAPI.getActiveProvider()
    const activeProvider = activeProviderResult.provider || 'gemini'
    currentSettings.activeProvider = activeProvider

    // Load settings for each provider dynamically
    for (const providerId of Object.keys(providerRegistry)) {
      // Get API key
      const keyResult = await window.electronAPI.getApiKey(providerId)
      const apiKey = keyResult.apiKey || ''

      // Get provider config
      const configResult = await window.electronAPI.getProviderConfig(providerId)
      const config = configResult.config || {}

      // Store in currentSettings
      if (!currentSettings.providers[providerId]) {
        currentSettings.providers[providerId] = {}
      }
      currentSettings.providers[providerId].apiKey = apiKey
      currentSettings.providers[providerId].model = config.model || providerRegistry[providerId].defaultModel
      currentSettings.providers[providerId].baseUrl = config.baseUrl || ''

      // Update form fields
      const apiKeyField = document.getElementById(`${providerId}-api-key`)
      const modelField = document.getElementById(`${providerId}-model`)
      const baseUrlField = document.getElementById(`${providerId}-baseurl`)

      if (apiKeyField) apiKeyField.value = apiKey
      if (modelField) modelField.value = currentSettings.providers[providerId].model
      if (baseUrlField) baseUrlField.value = currentSettings.providers[providerId].baseUrl
    }

    // Get system prompt from active provider config
    const activeConfig = currentSettings.providers[activeProvider] || {}
    currentSettings.systemPrompt = activeConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT

    // Update UI fields
    document.getElementById('provider-select').value = activeProvider
    document.getElementById('system-prompt').value = currentSettings.systemPrompt

    // Load memory settings
    const memorySettingsResult = await window.electronAPI.getMemorySettings()
    if (memorySettingsResult.success) {
      currentSettings.historyLimit = memorySettingsResult.settings.historyLimit || 10
      document.getElementById('history-limit').value = currentSettings.historyLimit
    }

    console.log('Settings loaded:', { activeProvider, providers: Object.keys(currentSettings.providers), historyLimit: currentSettings.historyLimit })
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

    // Clear existing options
    displaySelect.innerHTML = ''

    // Add display options
    displays.forEach((display, index) => {
      const option = document.createElement('option')
      option.value = index
      option.textContent = `Display ${index + 1}${display.primary ? ' (Primary)' : ''} - ${display.width}x${display.height}`
      displaySelect.appendChild(option)
    })

    // Select primary display
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
  // Provider selection change
  document.getElementById('provider-select').addEventListener('change', (e) => {
    currentSettings.activeProvider = e.target.value
    updateProviderUI()
  })

  // Display selection change
  document.getElementById('display-select').addEventListener('change', (e) => {
    currentSettings.primaryDisplay = parseInt(e.target.value)
  })

  // Set up listeners for each provider dynamically
  const timeouts = {}

  for (const providerId of Object.keys(providerRegistry)) {
    // API key input listener (debounced auto-test)
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
            // Save the API key immediately before testing
            await window.electronAPI.saveApiKey(providerId, apiKey)
            testProvider(providerId)
          }, 1000)
        }
      })
    }

    // Model selection change
    const modelField = document.getElementById(`${providerId}-model`)
    if (modelField) {
      modelField.addEventListener('change', (e) => {
        if (!currentSettings.providers[providerId]) {
          currentSettings.providers[providerId] = {}
        }
        currentSettings.providers[providerId].model = e.target.value
      })
    }

    // Base URL input (for custom provider)
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

  // Mode selection change
  document.getElementById('mode-select').addEventListener('change', (e) => {
    currentSettings.selectedMode = e.target.value
    updateModeUI()
  })
}

/**
 * Update UI based on selected provider
 */
function updateProviderUI() {
  const provider = currentSettings.activeProvider

  // Hide all provider sections dynamically
  for (const providerId of Object.keys(providerRegistry)) {
    const section = document.getElementById(`${providerId}-section`)
    if (section) {
      section.style.display = 'none'
    }
  }

  // Show selected provider section
  const activeSection = document.getElementById(`${provider}-section`)
  if (activeSection) {
    activeSection.style.display = 'block'
  }

  // Update provider info box if it exists
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
  const button = input.nextElementSibling

  if (input.type === 'password') {
    input.type = 'text'
    button.textContent = 'Hide'
  } else {
    input.type = 'password'
    button.textContent = 'Show'
  }
}

/**
 * Test provider connection
 */
async function testProvider(provider) {
  const statusEl = document.getElementById(`${provider}-status`)
  const apiKeyInput = document.getElementById(`${provider}-api-key`)
  const apiKey = apiKeyInput.value.trim()

  if (!apiKey) {
    showStatus(`${provider}-status`, 'Please enter an API key first', 'error')
    return
  }

  try {
    // Show testing message
    statusEl.className = 'status-message'
    statusEl.style.display = 'block'
     statusEl.style.background = 'rgba(182, 179, 180, 0.14)'
     statusEl.style.borderColor = 'rgba(182, 179, 180, 0.28)'
     statusEl.style.color = '#d7d4d5'
    statusEl.textContent = 'Testing connection...'

    // Validate API key (this will make a test request)
    const result = await window.electronAPI.validateApiKey(provider)

    if (result.valid) {
      showStatus(`${provider}-status`, `✓ Connection successful! Using ${provider} API`, 'success')
    } else {
      showStatus(`${provider}-status`, `✗ Invalid API key: ${result.error || 'Authentication failed'}`, 'error')
    }
  } catch (error) {
    console.error('Test provider error:', error)
    showStatus(`${provider}-status`, `✗ Connection failed: ${error.message}`, 'error')
  }
}

/**
 * Save settings
 */
async function saveSettings() {
  try {
    const activeProvider = document.getElementById('provider-select').value
    const systemPrompt = document.getElementById('system-prompt').value.trim() || DEFAULT_SYSTEM_PROMPT

    // Iterate through all providers dynamically
    for (const providerId of Object.keys(providerRegistry)) {
      const apiKeyField = document.getElementById(`${providerId}-api-key`)
      const modelField = document.getElementById(`${providerId}-model`)
      const baseUrlField = document.getElementById(`${providerId}-baseurl`)

      const apiKey = apiKeyField ? apiKeyField.value.trim() : ''
      const model = modelField ? modelField.value : providerRegistry[providerId].defaultModel
      const baseUrl = baseUrlField ? baseUrlField.value.trim() : ''

      // Validate that active provider has an API key (unless it's custom)
      if (providerId === activeProvider && !apiKey && providerId !== 'custom') {
        const providerName = providerRegistry[providerId].name
        showStatus('save-status', `Please enter a ${providerName} API key`, 'error')
        return
      }

      // Save API key if provided
      if (apiKey) {
        await window.electronAPI.saveApiKey(providerId, apiKey)
      }

      // Build provider config
      const config = { model, systemPrompt }
      if (baseUrl) {
        config.baseUrl = baseUrl
      }

      // Save provider configuration
      await window.electronAPI.setProviderConfig(providerId, config)
    }

    // Set active provider
    await window.electronAPI.setActiveProvider(activeProvider)

    // Show success message
    showStatus('save-status', '✓ Settings saved successfully!', 'success')

    // Close window after short delay
    setTimeout(() => {
      window.close()
    }, 1500)
  } catch (error) {
    console.error('Save settings error:', error)
    showStatus('save-status', `Failed to save settings: ${error.message}`, 'error')
  }
}

/**
 * Close settings window
 */
function closeSettings() {
  window.close()
}

/**
 * Show status message
 */
function showStatus(elementId, message, type) {
  const statusEl = document.getElementById(elementId)
  statusEl.textContent = message
  statusEl.className = `status-message ${type}`
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

    // Populate mode dropdown
    const modeSelect = document.getElementById('mode-select')
    modeSelect.innerHTML = ''

    modes.forEach(mode => {
      const option = document.createElement('option')
      option.value = mode.id
      option.textContent = mode.name
      modeSelect.appendChild(option)
    })

    // Select the active mode
    modeSelect.value = activeModeId

    // Update UI for selected mode
    updateModeUI()

    console.log('Modes loaded:', { count: modes.length, active: activeModeId })
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

  // Show/hide mode name field (only for custom modes)
  const modeNameContainer = document.getElementById('mode-name-container')
  const modeNameInput = document.getElementById('mode-name')
  const deleteBtn = document.getElementById('delete-mode-btn')

  if (mode.isDefault) {
    modeNameContainer.style.display = 'none'
    deleteBtn.disabled = true
    modeNameInput.value = ''
  } else {
    modeNameContainer.style.display = 'block'
    deleteBtn.disabled = false
    modeNameInput.value = mode.name
  }

  // Load mode prompt
  document.getElementById('system-prompt').value = mode.prompt || ''
}

/**
 * Create a new mode
 */
function createNewMode() {
  // Generate a unique ID
  const newId = 'mode-' + Date.now()
  const newMode = {
    id: newId,
    name: 'New Mode',
    prompt: DEFAULT_SYSTEM_PROMPT,
    isDefault: false
  }

  // Add to modes array
  currentSettings.modes.push(newMode)

  // Update dropdown
  const modeSelect = document.getElementById('mode-select')
  const option = document.createElement('option')
  option.value = newMode.id
  option.textContent = newMode.name
  modeSelect.appendChild(option)

  // Select the new mode
  modeSelect.value = newId
  currentSettings.selectedMode = newId

  // Update UI
  updateModeUI()

  // Focus on the name input
  document.getElementById('mode-name').focus()
}

/**
 * Delete the currently selected mode
 */
async function deleteMode() {
  const modeId = currentSettings.selectedMode

  if (modeId === 'default') {
    showStatus('mode-save-status', 'Cannot delete default mode', 'error')
    return
  }

  // Confirm deletion
  if (!confirm('Are you sure you want to delete this mode?')) {
    return
  }

  try {
    // Delete from server
    await window.electronAPI.deleteMode(modeId)

    // Remove from local array
    currentSettings.modes = currentSettings.modes.filter(m => m.id !== modeId)

    // Update dropdown
    const modeSelect = document.getElementById('mode-select')
    modeSelect.querySelector(`option[value="${modeId}"]`).remove()

    // Select default mode
    modeSelect.value = 'default'
    currentSettings.selectedMode = 'default'

    // Update UI
    updateModeUI()

    showStatus('mode-save-status', 'Mode deleted successfully', 'success')
    setTimeout(() => {
      document.getElementById('mode-save-status').style.display = 'none'
    }, 2000)
  } catch (error) {
    console.error('Failed to delete mode:', error)
    showStatus('mode-save-status', 'Failed to delete mode: ' + error.message, 'error')
  }
}

/**
 * Save memory settings
 */
async function saveMemorySettings() {
  try {
    const historyLimit = parseInt(document.getElementById('history-limit').value)
    
    // Validate input
    if (isNaN(historyLimit) || historyLimit < 5 || historyLimit > 50) {
      showStatus('memory-status', 'Please enter a valid number between 5 and 50', 'error')
      return
    }

    // Save to config
    await window.electronAPI.setHistoryLimit(historyLimit)
    currentSettings.historyLimit = historyLimit

    showStatus('memory-status', 'Memory settings saved successfully!', 'success')
    
    // Hide success message after 2 seconds
    setTimeout(() => {
      document.getElementById('memory-status').style.display = 'none'
    }, 2000)
  } catch (error) {
    console.error('Failed to save memory settings:', error)
    showStatus('memory-status', 'Failed to save settings: ' + error.message, 'error')
  }
}

// Make function globally accessible
window.saveMemorySettings = saveMemorySettings

/**
 * Save the currently selected mode
 */
async function saveCurrentMode() {
  const modeId = currentSettings.selectedMode
  const mode = currentSettings.modes.find(m => m.id === modeId)

  if (!mode) {
    showStatus('mode-save-status', 'Mode not found', 'error')
    return
  }

  // Get values from inputs
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

  // Update mode
  mode.name = name
  mode.prompt = prompt

  try {
    // Save to server
    await window.electronAPI.saveMode(mode)

    // Update dropdown text if name changed
    const modeSelect = document.getElementById('mode-select')
    const option = modeSelect.querySelector(`option[value="${modeId}"]`)
    if (option) {
      option.textContent = name
    }

    showStatus('mode-save-status', 'Mode saved successfully!', 'success')
    document.getElementById('mode-save-status').style.display = 'block'
    setTimeout(() => {
      document.getElementById('mode-save-status').style.display = 'none'
    }, 2000)
  } catch (error) {
    console.error('Failed to save mode:', error)
    showStatus('mode-save-status', 'Failed to save mode: ' + error.message, 'error')
    document.getElementById('mode-save-status').style.display = 'block'
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

// Make functions available globally for onclick handlers
window.togglePasswordVisibility = togglePasswordVisibility
window.testProvider = testProvider
window.saveSettings = saveSettings
window.closeSettings = closeSettings
window.createNewMode = createNewMode
window.deleteMode = deleteMode
window.saveCurrentMode = saveCurrentMode
