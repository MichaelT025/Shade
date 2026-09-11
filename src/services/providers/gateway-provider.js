const LLMProvider = require('../llm-service')

// These adapters deliberately keep wire formats separate. Endpoint compatibility
// does not imply compatible image blocks, system prompts, or stream events.
function makeRequest(config, text, image, history = [], stream = false) {
  if (image && config.capabilities?.vision !== true) {
    throw new Error(`${config.model} does not have confirmed screenshot support. Remove the screenshot or choose an image-capable model.`)
  }
  const turns = history.map(m => ({ role: m.type === 'user' || m.role === 'user' ? 'user' : 'assistant', text: m.text || m.content || '' }))
  turns.push({ role: 'user', text: text || '', image })
  const system = config.systemPrompt || ''
  const model = config.model
  switch (config.protocol) {
    case 'openai-chat-completions': {
      const messages = turns.map(m => ({ role: m.role, content: m.image ? [
        { type: 'text', text: m.text }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${m.image}` } }
      ] : m.text }))
      if (system) messages.unshift({ role: 'system', content: system })
      return { path: '/chat/completions', body: { model, messages, max_tokens: 4096, stream,
        ...(config.providerId === 'deepseek' ? { thinking: { type: 'disabled' } } : {}) } }
    }
    case 'openai-responses':
      return { path: '/responses', body: { model, instructions: system, max_output_tokens: 4096, stream,
        input: turns.map(m => ({ role: m.role, content: m.image ? [
          { type: 'input_text', text: m.text }, { type: 'input_image', image_url: `data:image/jpeg;base64,${m.image}` }
        ] : m.text })) } }
    case 'anthropic-messages':
      return { path: '/messages', body: { model, system, max_tokens: 4096, stream,
        messages: turns.map(m => ({ role: m.role, content: m.image ? [
          { type: 'text', text: m.text }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.image } }
        ] : m.text })) } }
    case 'google-generative-language':
      return { path: `/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
        body: { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: { maxOutputTokens: 4096 },
          contents: turns.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [
            { text: m.text }, ...(m.image ? [{ inlineData: { mimeType: 'image/jpeg', data: m.image } }] : [])
          ] })) } }
    default: throw new Error(`Unsupported protocol for ${model}. Refresh the model list or choose another model.`)
  }
}

function responseText(protocol, data, streaming) {
  if (data.error || data.type === 'error' || data.type === 'response.failed' || data.type === 'response.incomplete') {
    throw new Error(data.error?.message || data.response?.error?.message || 'Provider returned a stream error')
  }
  if (protocol === 'openai-chat-completions') return (streaming ? data.choices?.[0]?.delta?.content : data.choices?.[0]?.message?.content) || ''
  if (protocol === 'openai-responses') {
    if (streaming) return data.type === 'response.output_text.delta' ? data.delta || '' : ''
    return data.output_text || (data.output || []).flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text || '').join('')
  }
  if (protocol === 'anthropic-messages') return streaming
    ? (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' ? data.delta.text || '' : '')
    : (data.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('')
  return (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('')
}

async function consumeSSE(body, onData) {
  if (!body) throw new Error('Provider returned an empty stream')
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let dataLines = []
  let eventSize = 0
  let done = false
  const dispatch = () => {
    if (!dataLines.length) return
    const data = dataLines.join('\n')
    dataLines = []
    eventSize = 0
    if (data === '[DONE]') { done = true; return }
    onData(JSON.parse(data))
  }
  const line = value => {
    if (!value) dispatch()
    else if (value.startsWith('data:')) {
      eventSize += value.length
      if (eventSize > 4 * 1024 * 1024) throw new Error('Provider stream event exceeded size limit')
      dataLines.push(value.slice(5).replace(/^ /, ''))
    }
  }
  try {
    while (!done) {
      const result = await reader.read()
      pending += decoder.decode(result.value || new Uint8Array(), { stream: !result.done })
      let newline
      while ((newline = pending.indexOf('\n')) !== -1 && !done) {
        line(pending.slice(0, newline).replace(/\r$/, ''))
        pending = pending.slice(newline + 1)
      }
      if (pending.length > 4 * 1024 * 1024) throw new Error('Provider stream event exceeded size limit')
      if (result.done) { if (pending) line(pending.replace(/\r$/, '')); dispatch(); break }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

class GatewayProvider extends LLMProvider {
  constructor(apiKey, config = {}, dependencies = {}) {
    super(apiKey, config)
    this.fetch = dependencies.fetch || globalThis.fetch
    this.modelName = config.model
  }

  getName() { return this.config.providerId }

  async request(path, body, signal, consume) {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.config.requestTimeoutMs || 120000)
    const headers = { ...this.config.defaultHeaders, 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }
    if (this.config.protocol === 'anthropic-messages') {
      headers['x-api-key'] = this.apiKey
      headers['anthropic-version'] = '2023-06-01'
    }
    if (this.config.protocol === 'google-generative-language') headers['x-goog-api-key'] = this.apiKey
    try {
      const response = await this.fetch(this.config.baseUrl.replace(/\/$/, '') + path, {
        method: body ? 'POST' : 'GET', headers, signal: controller.signal,
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      if (!response.ok) {
        const hints = { 401: 'API key rejected. Check the saved key.', 403: 'Access denied for this key or model.',
          402: 'Insufficient credits or an inactive subscription.', 429: 'Rate or subscription limit reached. Try again later.',
          404: 'Model or endpoint unavailable. Refresh the model list.', 400: 'Request rejected. Check model and image support.' }
        throw new Error(`HTTP ${response.status}: ${hints[response.status] || 'Provider service failed. Try again later.'}`)
      }
      return await consume(response)
    } catch (error) {
      if (timedOut) throw new Error(`${this.getName()} request timed out. Try again or choose another model.`)
      if (signal?.aborted || error.name === 'AbortError') throw error
      // Error bodies can echo credentials or requests; don't expose them.
      const message = String(error.message)
      throw new Error(`${this.getName()}: ${this.apiKey ? message.split(this.apiKey).join('[redacted]') : message}`)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  async sendMessage(text, image = null) {
    const request = makeRequest(this.config, text, image)
    return this.request(request.path, request.body, null, async r => responseText(this.config.protocol, await r.json(), false))
  }

  async streamResponse(text, image = null, history = [], onChunk, signal = null) {
    const request = makeRequest(this.config, text, image, history, true)
    return this.request(request.path, request.body, signal, r => consumeSSE(r.body, data => {
      const text = responseText(this.config.protocol, data, true)
      if (text) onChunk(text)
    }))
  }

  async validateApiKey() {
    // A public /models endpoint cannot prove a key is valid. Use one bounded
    // text request only when the user explicitly clicks Verify.
    const request = makeRequest(this.config, 'Reply OK.', null)
    if ('max_tokens' in request.body) request.body.max_tokens = 16
    if ('max_output_tokens' in request.body) request.body.max_output_tokens = 16
    if (request.body.generationConfig) request.body.generationConfig.maxOutputTokens = 16
    await this.request(request.path, request.body, null, async r => responseText(this.config.protocol, await r.json(), false))
    return true
  }
}

module.exports = { GatewayProvider, makeRequest, responseText, consumeSSE }
