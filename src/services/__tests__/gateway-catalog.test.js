import { describe, expect, test } from 'vitest'

const { parseGatewayModels, providers } = await import('../providers/gateway-catalog.js')

describe('gateway catalog', () => {
  test('normalizes aliases before metadata lookup and deduplicates canonical IDs', () => {
    const provider = {
      catalogId: 'vendor',
      modelAliases: { legacy: 'canonical' }
    }
    const metadata = {
      vendor: {
        npm: '@ai-sdk/openai-compatible',
        models: {
          canonical: { name: 'Canonical Model', modalities: { input: ['text', 'image'], output: ['text'] }, reasoning: true }
        }
      }
    }

    const result = parseGatewayModels(provider, { data: [{ id: 'legacy' }, { id: 'canonical' }] }, metadata)

    expect(result).toEqual({
      canonical: {
        name: 'Canonical Model', protocol: 'openai-chat-completions',
        capabilities: { vision: true, streaming: true, reasoning: true },
        metadataSource: 'https://models.dev/api.json'
      }
    })
  })

  test('filters invalid IDs, unknown protocols, non-text outputs, and unmapped advertised models', () => {
    const provider = { catalogId: 'vendor' }
    const metadata = {
      vendor: {
        models: {
          valid: { provider: { npm: '@ai-sdk/anthropic' }, modalities: { input: ['text'], output: ['text'] } },
          audio: { provider: { npm: '@ai-sdk/google' }, modalities: { input: ['text'], output: ['audio'] } },
          unknown: { provider: { npm: '@vendor/unsupported' }, modalities: { input: ['text'], output: ['text'] } }
        }
      }
    }
    const availability = { data: [null, { id: '../bad id' }, { id: 'valid' }, { id: 'audio' }, { id: 'unknown' }, { id: 'advertised-only' }] }

    expect(parseGatewayModels(provider, availability, metadata)).toEqual({
      valid: {
        name: 'valid', protocol: 'anthropic-messages',
        capabilities: { vision: false, streaming: true, reasoning: false },
        metadataSource: 'https://models.dev/api.json'
      }
    })
  })

  test('uses an explicitly protocol-mapped fallback while preserving its metadata', () => {
    const fallback = { cached: { name: 'Cached', protocol: 'openai-responses', capabilities: { vision: false }, verifiedAt: 'today' } }

    expect(parseGatewayModels({}, { data: [{ id: 'cached' }] }, {}, fallback)).toEqual({ cached: fallback.cached })
  })

  test.each([
    [null, 'Invalid provider model catalog'],
    [{ data: [{ id: 'unmapped' }] }, 'No supported models returned']
  ])('rejects an unusable catalog while preserving the caller\'s current list', (availability, message) => {
    expect(() => parseGatewayModels({}, availability, {})).toThrow(message)
  })

  test('ships compatibility aliases for DeepSeek legacy IDs', () => {
    expect(providers.deepseek.modelAliases).toMatchObject({
      'deepseek-v4-flash': 'deepseek-flash',
      'deepseek-v4-flash-vision-exp': 'deepseek-flash'
    })
  })
})
