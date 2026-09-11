const zenModels = require('./zen-models.json')

const providers = {
  'opencode-zen': {
    name: 'OpenCode Zen', type: 'gateway', strictCapabilities: true, requiresApiKey: true,
    description: 'Pay-as-you-go models with verified screenshot capabilities',
    website: 'https://opencode.ai/zen', baseUrl: 'https://opencode.ai/zen/v1',
    catalogId: 'opencode', defaultModel: 'claude-sonnet-4-5', models: zenModels,
    verificationNotice: 'Testing the key sends a small text request and may use credits.'
  },
  'opencode-go': {
    name: 'OpenCode Go', type: 'gateway', strictCapabilities: true, requiresApiKey: true,
    description: 'Coding-agent subscription; Shade compatibility pending',
    website: 'https://opencode.ai/docs/go/', baseUrl: 'https://opencode.ai/zen/go/v1',
    catalogId: 'opencode-go', defaultModel: 'deepseek-v4-flash-vision-exp',
    disabled: true, disabledReason: 'OpenCode Go is intended for coding-agent traffic. Availability in Shade is pending confirmation from OpenCode.',
    models: { 'deepseek-v4-flash-vision-exp': zenModels['deepseek-v4-flash-vision-exp'] }
  },
  deepseek: {
    name: 'DeepSeek', type: 'gateway', strictCapabilities: true, requiresApiKey: true,
    description: 'Direct DeepSeek API with screenshot-capable Flash',
    website: 'https://platform.deepseek.com/api_keys', baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    verificationNotice: 'Testing the key sends a small text request and may use credits.',
    modelAliases: { 'deepseek-v4-flash': 'deepseek-flash', 'deepseek-v4-flash-vision-exp': 'deepseek-flash' },
    models: {
      'deepseek-flash': { name: 'DeepSeek Flash', protocol: 'openai-chat-completions',
        capabilities: { vision: true, streaming: true, reasoning: true }, metadataSource: 'https://api-docs.deepseek.com/guides/vision/' },
      'deepseek-v4-pro': { name: 'DeepSeek V4 Pro', protocol: 'openai-chat-completions',
        capabilities: { vision: false, streaming: true, reasoning: true }, metadataSource: 'https://api-docs.deepseek.com/quick_start/pricing/' }
    }
  }
}

const sdkProtocols = {
  '@ai-sdk/openai-compatible': 'openai-chat-completions', '@ai-sdk/openai': 'openai-responses',
  '@ai-sdk/anthropic': 'anthropic-messages', '@ai-sdk/google': 'google-generative-language'
}

function parseGatewayModels(provider, availability, metadata, fallback = {}) {
  if (!Array.isArray(availability?.data)) throw new Error('Invalid provider model catalog; keeping the existing list')
  const catalog = metadata?.[provider.catalogId]
  const models = {}
  for (const entry of availability.data) {
    if (typeof entry?.id !== 'string' || !/^[a-zA-Z0-9._:/-]{1,200}$/.test(entry.id)) continue
    const id = provider.modelAliases?.[entry.id] || entry.id
    if (id in models) continue
    const remote = catalog?.models?.[id]
    const protocol = sdkProtocols[remote?.provider?.npm || catalog?.npm]
    const input = remote?.modalities?.input
    if (remote && protocol && Array.isArray(input) && remote.modalities?.output?.includes('text')) {
      models[id] = { name: remote.name || id, protocol,
        capabilities: { vision: input.includes('image'), streaming: true, reasoning: remote.reasoning === true },
        metadataSource: 'https://models.dev/api.json' }
    } else if (fallback[id]?.protocol) {
      models[id] = { ...fallback[id] }
    }
    // Unmapped IDs stay out of the picker: protocol and image support cannot be
    // inferred from a model's spelling or the fact it appears in /models.
  }
  if (!Object.keys(models).length) throw new Error('No supported models returned; keeping the existing list')
  return models
}

module.exports = { providers, parseGatewayModels }
