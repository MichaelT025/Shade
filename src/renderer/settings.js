/**
 * GhostPad Settings Window
 * Handles provider configuration, API keys, and preferences
 */

// Current settings state
let currentSettings = {
  activeProvider: 'gemini',
  geminiApiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openaiModel: 'gpt-4.1',
  anthropicModel: 'claude-sonnet-4-5',
  primaryDisplay: 0,
  systemPrompt: ''
}

// Provider metadata
const providerInfo = {
  gemini: {
    name: 'Google Gemini',
    icon: '🔷',
    description: 'Fast and efficient vision model',
    badge: 'Active'
  },
  openai: {
    name: 'OpenAI GPT-4',
    icon: '🟢',
    description: 'Powerful multimodal AI',
    badge: 'Available'
  },
  anthropic: {
    name: 'Anthropic Claude',
    icon: '🟣',
    description: 'Advanced reasoning capabilities',
    badge: 'Available'
  }
}

/**
 * Initialize settings window
 */
async function init() {
  console.log('Initializing settings window...')

  // Load current settings
  await loadSettings()

  // Load available displays
  await loadDisplays()

  // Set up event listeners
  setupEventListeners()

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

    // Get system prompt from active provider config
    const activeConfig = activeProvider === 'gemini' ? geminiConfig :
                        activeProvider === 'openai' ? openaiConfig :
                        anthropicConfig
    currentSettings.systemPrompt = activeConfig.systemPrompt || ''

    // Update form fields
    document.getElementById('provider-select').value = activeProvider
    document.getElementById('gemini-api-key').value = currentSettings.geminiApiKey || ''
    document.getElementById('openai-api-key').value = currentSettings.openaiApiKey || ''
    document.getElementById('anthropic-api-key').value = currentSettings.anthropicApiKey || ''
    document.getElementById('gemini-model').value = currentSettings.geminiModel
    document.getElementById('openai-model').value = currentSettings.openaiModel
    document.getElementById('anthropic-model').value = currentSettings.anthropicModel
    document.getElementById('system-prompt').value = currentSettings.systemPrompt

    console.log('Settings loaded:', { activeProvider, hasGeminiKey: !!currentSettings.geminiApiKey })
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
  providerInfoEl.innerHTML = `
    <div class="provider-icon">${info.icon}</div>
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
    const systemPrompt = document.getElementById('system-prompt').value.trim()

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
