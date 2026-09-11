import { describe, expect, test, vi } from 'vitest'

const { GatewayProvider, consumeSSE, makeRequest, responseText } = await import('../providers/gateway-provider.js')

const baseConfig = {
  providerId: 'gateway',
  baseUrl: 'https://gateway.example/v1/',
  model: 'example-model',
  systemPrompt: 'Be concise.',
  capabilities: { vision: true }
}

function streamFrom(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    }
  })
}

describe('gateway wire protocols', () => {
  test.each([
    {
      protocol: 'openai-chat-completions', path: '/chat/completions', tokenField: 'max_tokens',
      assertBody: body => expect(body.messages).toEqual([
        { role: 'system', content: 'Be concise.' },
        { role: 'assistant', content: 'previous' },
        { role: 'user', content: [{ type: 'text', text: 'describe' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aW1n' } }] }
      ])
    },
    {
      protocol: 'openai-responses', path: '/responses', tokenField: 'max_output_tokens',
      assertBody: body => {
        expect(body.instructions).toBe('Be concise.')
        expect(body.input.at(-1).content).toEqual([
          { type: 'input_text', text: 'describe' },
          { type: 'input_image', image_url: 'data:image/jpeg;base64,aW1n' }
        ])
      }
    },
    {
      protocol: 'anthropic-messages', path: '/messages', tokenField: 'max_tokens',
      assertBody: body => expect(body.messages.at(-1).content).toEqual([
        { type: 'text', text: 'describe' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aW1n' } }
      ])
    },
    {
      protocol: 'google-generative-language', path: '/models/example-model:streamGenerateContent?alt=sse', tokenField: null,
      assertBody: body => {
        expect(body.systemInstruction.parts).toEqual([{ text: 'Be concise.' }])
        expect(body.contents).toEqual([
          { role: 'model', parts: [{ text: 'previous' }] },
          { role: 'user', parts: [{ text: 'describe' }, { inlineData: { mimeType: 'image/jpeg', data: 'aW1n' } }] }
        ])
      }
    }
  ])('builds a $protocol streaming request without leaking another protocol format', ({ protocol, path, tokenField, assertBody }) => {
    const request = makeRequest({ ...baseConfig, protocol }, 'describe', 'aW1n', [{ type: 'ai', text: 'previous' }], true)

    expect(request.path).toBe(path)
    if (tokenField) {
      expect(request.body).toMatchObject({ model: 'example-model', stream: true })
      expect(request.body[tokenField]).toBe(4096)
    } else {
      expect(request.body).not.toHaveProperty('model')
      expect(request.body).not.toHaveProperty('stream')
      expect(request.body.generationConfig.maxOutputTokens).toBe(4096)
    }
    assertBody(request.body)
  })

  test.each([
    ['openai-chat-completions', { choices: [{ delta: { content: 'chat' } }] }, 'chat'],
    ['openai-responses', { type: 'response.output_text.delta', delta: 'responses' }, 'responses'],
    ['anthropic-messages', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'anthropic' } }, 'anthropic'],
    ['google-generative-language', { candidates: [{ content: { parts: [{ text: 'gemini' }, { text: 'hidden', thought: true }] } }] }, 'gemini']
  ])('extracts streaming text for %s', (protocol, event, expected) => {
    expect(responseText(protocol, event, true)).toBe(expected)
  })

  test('rejects screenshots before any network request for an unconfirmed vision model', async () => {
    const fetch = vi.fn()
    const provider = new GatewayProvider('secret', { ...baseConfig, protocol: 'openai-chat-completions', capabilities: { vision: false } }, { fetch })

    await expect(provider.sendMessage('describe', 'aW1n')).rejects.toThrow('does not have confirmed screenshot support')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('gateway SSE transport', () => {
  test('reassembles fragmented CRLF, multiline data, and split UTF-8 bytes, then cancels the reader at DONE', async () => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode('data: {"word":"café",\r\ndata: "more":true}\r\n\r\ndata: [DONE]\r\n\r\ndata: {"ignored":true}\r\n\r\n')
    const accent = bytes.indexOf(0xc3)
    const chunks = [bytes.slice(0, 7), bytes.slice(7, accent + 1), bytes.slice(accent + 1, accent + 9), bytes.slice(accent + 9)]
    const events = []

    await consumeSSE(streamFrom(chunks), event => events.push(event))

    expect(events).toEqual([{ word: 'café', more: true }])
  })

  test('surfaces provider error events without exposing later chunks', async () => {
    const body = streamFrom([new TextEncoder().encode('data: {"error":{"message":"quota exhausted"}}\n\ndata: {"choices":[{"delta":{"content":"ignored"}}]}\n\n')])

    await expect(consumeSSE(body, data => responseText('openai-chat-completions', data, true))).rejects.toThrow('quota exhausted')
  })

  test('rejects malformed JSON and an empty response body', async () => {
    const malformed = streamFrom([new TextEncoder().encode('data: {bad json}\n\n')])

    await expect(consumeSSE(malformed, () => {})).rejects.toBeInstanceOf(SyntaxError)
    await expect(consumeSSE(null, () => {})).rejects.toThrow('empty stream')
  })

  test('forwards caller abort to fetch and preserves AbortError', async () => {
    const fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true })
    }))
    const provider = new GatewayProvider('secret', { ...baseConfig, protocol: 'openai-chat-completions' }, { fetch })
    const controller = new AbortController()
    const pending = provider.streamResponse('hello', null, [], vi.fn(), controller.signal)

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
  })

  test('does not call fetch when the caller signal is already aborted', async () => {
    const fetch = vi.fn()
    const provider = new GatewayProvider('secret', { ...baseConfig, protocol: 'openai-chat-completions' }, { fetch })
    const controller = new AbortController()
    controller.abort()

    await expect(provider.streamResponse('hello', null, [], vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('gateway HTTP behavior', () => {
  test.each([
    [401, 'API key rejected. Check the saved key.'],
    [402, 'Insufficient credits or an inactive subscription.'],
    [429, 'Rate or subscription limit reached. Try again later.']
  ])('turns HTTP %i into an actionable error without reading the response body', async (status, hint) => {
    const json = vi.fn()
    const fetch = vi.fn().mockResolvedValue({ ok: false, status, json })
    const provider = new GatewayProvider('secret', { ...baseConfig, protocol: 'openai-chat-completions' }, { fetch })

    await expect(provider.sendMessage('hello')).rejects.toThrow(`HTTP ${status}: ${hint}`)
    expect(json).not.toHaveBeenCalled()
  })

  test('redacts every occurrence of the API key from transport errors', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('upstream echoed secret, then secret again'))
    const provider = new GatewayProvider('secret', { ...baseConfig, protocol: 'openai-chat-completions' }, { fetch })

    await expect(provider.sendMessage('hello')).rejects.toThrow('gateway: upstream echoed [redacted], then [redacted] again')
  })

  test('validateApiKey sends a bounded POST to the inference endpoint instead of probing public models', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'OK' } }] }) })
    const provider = new GatewayProvider('secret', { ...baseConfig, protocol: 'openai-chat-completions' }, { fetch })

    await expect(provider.validateApiKey()).resolves.toBe(true)

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('https://gateway.example/v1/chat/completions')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toMatchObject({ model: 'example-model', max_tokens: 16, stream: false })
    expect(url).not.toContain('/models')
  })

  test('aborts a stalled fetch at requestTimeoutMs and reports a provider timeout', async () => {
    vi.useFakeTimers()
    let requestSignal
    const fetch = vi.fn((_url, options) => {
      requestSignal = options.signal
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true })
      })
    })
    const provider = new GatewayProvider('secret', { ...baseConfig, protocol: 'openai-chat-completions', requestTimeoutMs: 10 }, { fetch })

    try {
      const pending = provider.sendMessage('hello')
      const rejection = expect(pending).rejects.toThrow('gateway request timed out. Try again or choose another model.')
      await vi.advanceTimersByTimeAsync(10)

      await rejection
      expect(requestSignal.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('clears the request timeout after a successful response', async () => {
    vi.useFakeTimers()
    let requestSignal
    const fetch = vi.fn((_url, options) => {
      requestSignal = options.signal
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: 'done' } }] }) })
    })
    const provider = new GatewayProvider('secret', { ...baseConfig, protocol: 'openai-chat-completions', requestTimeoutMs: 10 }, { fetch })

    try {
      await expect(provider.sendMessage('hello')).resolves.toBe('done')
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(20)
      expect(requestSignal.aborted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
