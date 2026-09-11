const PROTOCOLS = new Set([
  'openai-chat-completions', 'openai-responses', 'anthropic-messages', 'google-generative-language'
])
const TYPE_PROTOCOLS = {
  gemini: 'google-generative-language',
  openai: 'openai-chat-completions',
  anthropic: 'anthropic-messages',
  'openai-compatible': 'openai-chat-completions'
}

// Unknown is deliberately distinct from false. A model name or a compatible
// endpoint is not evidence that the model accepts screenshots.
function getModelCapabilities(provider = {}, model = {}) {
  const declared = { ...provider.capabilities, ...model.capabilities }
  const protocol = model.protocol || provider.protocol || TYPE_PROTOCOLS[provider.type]
  return {
    protocol: PROTOCOLS.has(protocol) ? protocol : null,
    vision: typeof declared.vision === 'boolean' ? declared.vision : null,
    streaming: typeof declared.streaming === 'boolean' ? declared.streaming : null,
    reasoning: typeof declared.reasoning === 'boolean' ? declared.reasoning : null
  }
}

function mergeModelMetadata(existing = {}, fetched = {}) {
  return {
    ...existing,
    ...fetched,
    ...(existing.options || fetched.options ? { options: { ...existing.options, ...fetched.options } } : {}),
    ...(existing.capabilities || fetched.capabilities
      ? { capabilities: { ...existing.capabilities, ...fetched.capabilities } } : {})
  }
}

module.exports = { getModelCapabilities, mergeModelMetadata }
