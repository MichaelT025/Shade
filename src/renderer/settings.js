/**
 * GhostPad Settings Window
 * Handles provider configuration, API keys, and preferences
 */

import { getIcon, initIcons } from './assets/icons/icons.js';

// Default system prompt for screenshot analysis
const DEFAULT_SYSTEM_PROMPT = `
You're GhostPad, a real time assistant that gives short precise answers. 
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
  geminiApiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiModel: 'gpt-4.1',
  historyLimit: 10,
  anthropicModel: 'claude-sonnet-4-5',
  primaryDisplay: 0,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  modes: [],
  selectedMode: 'default'
}

// Provider metadata
const providerInfo = {
  gemini: {
    name: 'Google Gemini',
    iconName: 'gemini',
    description: 'Fast and efficient vision model',
    badge: 'Active'
  },
  openai: {
    name: 'OpenAI GPT',
    iconName: 'openai',
    description: 'Powerful multimodal AI',
    badge: 'Available'
  },
  anthropic: {
    name: 'Anthropic Claude',
    iconName: 'anthropic',
    description: 'Advanced reasoning capabilities',
    badge: 'Available'
  }
}

/**
 * Initialize settings window
 */
async function init() {
  console.log('Initializing settings window...')

  // Initialize custom icons
  await initIcons()

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

    // Get API keys for all providers
    const geminiKeyResult = await window.electronAPI.getApiKey('gemini')
    const openaiKeyResult = await window.electronAPI.getApiKey('openai')
    const anthropicKeyResult = await window.electronAPI.getApiKey('anthropic')

    currentSettings.geminiApiKey = geminiKeyResult.apiKey || ''
    currentSettings.openaiApiKey = openaiKeyResult.apiKey || ''
    currentSettings.anthropicApiKey = anthropicKeyResult.apiKey || ''

    // Get provider configurations
    const geminiConfigResult = await window.electronAPI.getProviderConfig('gemini')
    const openaiConfigResult = await window.electronAPI.getProviderConfig('openai')
    const anthropicConfigResult = await window.electronAPI.getProviderConfig('anthropic')

    const geminiConfig = geminiConfigResult.config || {}
    const openaiConfig = openaiConfigResult.config || {}
    const anthropicConfig = anthropicConfigResult.config || {}

    currentSettings.geminiModel = geminiConfig.model || 'gemini-2.5-flash'
    currentSettings.openaiModel = openaiConfig.model || 'gpt-4.1'
    currentSettings.anthropicModel = anthropicConfig.model || 'claude-sonnet-4-5'

    // Get system prompt from active provider config, use default if not set
    const activeConfig = activeProvider === 'gemini' ? geminiConfig :
                        activeProvider === 'openai' ? openaiConfig :
                        anthropicConfig
    currentSettings.systemPrompt = activeConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT

    // Update form fields
    document.getElementById('provider-select').value = activeProvider
    document.getElementById('gemini-api-key').value = currentSettings.geminiApiKey || ''
    document.getElementById('openai-api-key').value = currentSettings.openaiApiKey || ''
    document.getElementById('anthropic-api-key').value = currentSettings.anthropicApiKey || ''
    document.getElementById('gemini-model').value = currentSettings.geminiModel
    document.getElementById('openai-model').value = currentSettings.openaiModel
    document.getElementById('anthropic-model').value = currentSettings.anthropicModel
    document.getElementById('system-prompt').value = currentSettings.systemPrompt

    // Load memory settings
    const memorySettingsResult = await window.electronAPI.getMemorySettings()
    if (memorySettingsResult.success) {
      currentSettings.historyLimit = memorySettingsResult.settings.historyLimit || 10
      document.getElementById('history-limit').value = currentSettings.historyLimit
    }

    console.log('Settings loaded:', { activeProvider, hasGeminiKey: !!currentSettings.geminiApiKey, historyLimit: currentSettings.historyLimit })
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

  // Auto-test API keys on input (debounced)
  let geminiTimeout, openaiTimeout, anthropicTimeout

  document.getElementById('gemini-api-key').addEventListener('input', (e) => {
    clearTimeout(geminiTimeout)
    const apiKey = e.target.value.trim()
    if (apiKey.length > 10) {  // Only test if key looks valid
      geminiTimeout = setTimeout(async () => {
        currentSettings.geminiApiKey = apiKey
        // Save the API key immediately before testing
        await window.electronAPI.saveApiKey('gemini', apiKey)
        testProvider('gemini')
      }, 1000)  // Wait 1 second after user stops typing
    }
  })

  document.getElementById('openai-api-key').addEventListener('input', (e) => {
    clearTimeout(openaiTimeout)
    const apiKey = e.target.value.trim()
    if (apiKey.length > 10) {
      openaiTimeout = setTimeout(async () => {
        currentSettings.openaiApiKey = apiKey
        // Save the API key immediately before testing
        await window.electronAPI.saveApiKey('openai', apiKey)
        testProvider('openai')
      }, 1000)
    }
  })

  document.getElementById('anthropic-api-key').addEventListener('input', (e) => {
    clearTimeout(anthropicTimeout)
    const apiKey = e.target.value.trim()
    if (apiKey.length > 10) {
      anthropicTimeout = setTimeout(async () => {
        currentSettings.anthropicApiKey = apiKey
        // Save the API key immediately before testing
        await window.electronAPI.saveApiKey('anthropic', apiKey)
        testProvider('anthropic')
      }, 1000)
    }
  })

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

  // Hide all provider sections
  document.getElementById('gemini-section').style.display = 'none'
  document.getElementById('openai-section').style.display = 'none'
  document.getElementById('anthropic-section').style.display = 'none'

  // Show selected provider section
  document.getElementById(`${provider}-section`).style.display = 'block'

  // Update provider info box
  const info = providerInfo[provider]
  const providerInfoEl = document.getElementById('current-provider-info')
  const iconSvg = getIcon(info.iconName, 'icon-svg')
  providerInfoEl.innerHTML = `
    <div class="provider-icon">${iconSvg}</div>
    <div class="provider-details">
      <div class="provider-name">${info.name} <span class="provider-badge active">${info.badge}</span></div>
      <div class="provider-status">${info.description}</div>
    </div>
  `
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
    statusEl.style.background = 'rgba(74, 158, 255, 0.2)'
    statusEl.style.borderColor = 'rgba(74, 158, 255, 0.4)'
    statusEl.style.color = '#4A9EFF'
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
    // Get current form values
    const geminiApiKey = document.getElementById('gemini-api-key').value.trim()
    const openaiApiKey = document.getElementById('openai-api-key').value.trim()
    const anthropicApiKey = document.getElementById('anthropic-api-key').value.trim()
    const activeProvider = document.getElementById('provider-select').value
    const geminiModel = document.getElementById('gemini-model').value
    const openaiModel = document.getElementById('openai-model').value
    const anthropicModel = document.getElementById('anthropic-model').value
    const systemPrompt = document.getElementById('system-prompt').value.trim() || DEFAULT_SYSTEM_PROMPT

    // Validate that active provider has an API key
    if (activeProvider === 'gemini' && !geminiApiKey) {
      showStatus('save-status', 'Please enter a Gemini API key', 'error')
      return
    }
    if (activeProvider === 'openai' && !openaiApiKey) {
      showStatus('save-status', 'Please enter an OpenAI API key', 'error')
      return
    }
    if (activeProvider === 'anthropic' && !anthropicApiKey) {
      showStatus('save-status', 'Please enter an Anthropic API key', 'error')
      return
    }

    // Save API keys
    if (geminiApiKey) await window.electronAPI.saveApiKey('gemini', geminiApiKey)
    if (openaiApiKey) await window.electronAPI.saveApiKey('openai', openaiApiKey)
    if (anthropicApiKey) await window.electronAPI.saveApiKey('anthropic', anthropicApiKey)

    // Save provider configurations (with system prompt)
    await window.electronAPI.setProviderConfig('gemini', { model: geminiModel, systemPrompt })
    await window.electronAPI.setProviderConfig('openai', { model: openaiModel, systemPrompt })
    await window.electronAPI.setProviderConfig('anthropic', { model: anthropicModel, systemPrompt })

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
