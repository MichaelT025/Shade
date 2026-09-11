import { describe, test, expect, beforeEach } from 'vitest'
import capabilityService from '../model-capabilities.js'
import registry from '../provider-registry.js'
import LLMFactory from '../llm-factory.js'
import refresh from '../model-refresh.js'

const { getModelCapabilities } = capabilityService

describe('provider capability foundation', () => {
  beforeEach(() => registry.initProvidersPath(null))

  test('does not infer vision from model names or compatible endpoints', () => {
    expect(getModelCapabilities({ type: 'openai-compatible' }, { name: 'Vision Super Model' })).toEqual({
      protocol: 'openai-chat-completions', vision: null, streaming: null, reasoning: null
    })
  })

  test('supports per-model protocol and explicit text-only overrides', () => {
    expect(getModelCapabilities({ type: 'openai-compatible', capabilities: { vision: true } }, {
      protocol: 'anthropic-messages', capabilities: { vision: false, streaming: true }
    })).toMatchObject({ protocol: 'anthropic-messages', vision: false, streaming: true })
  })

  test('refresh retains capabilities and options when the API only provides a name', () => {
    registry.updateProviderModels('openai', {
      example: { name: 'Old', capabilities: { vision: true, streaming: true }, options: { reasoningEffort: 'high' } }
    })
    registry.updateProviderModels('openai', { example: { name: 'New' } })
    expect(registry.getModels('openai')[0]).toMatchObject({ name: 'New',
      capabilities: { vision: true, streaming: true }, options: { reasoningEffort: 'high' } })
    registry.updateProviderModels('openai', { example: { capabilities: { vision: false } } })
    expect(registry.getModels('openai', { visionOnly: true })).toEqual([])
  })

  test('vision-only lists exclude unknown and explicitly text-only models', () => {
    registry.updateProviderModels('openai', {
      known: { capabilities: { vision: true } }, text: { capabilities: { vision: false } }, unknown: {}
    })
    expect(registry.getModels('openai', { visionOnly: true }).map(m => m.id)).toEqual(['known'])
  })

  test('empty refreshes retain the previous working catalog', () => {
    const previous = registry.getModels('gemini')
    expect(() => registry.updateProviderModels('gemini', {})).toThrow('keeping the existing model cache')
    expect(registry.getModels('gemini')).toEqual(previous)
  })

  test('compatible providers use their own registry identity and cannot spoof it through config', () => {
    const provider = LLMFactory.createProvider('openrouter', 'test-key', { providerId: 'openai' })
    expect(provider.config.providerId).toBe('openrouter')
    expect(provider.config.model).toBe(registry.getProvider('openrouter').defaultModel)
    expect(provider.getModels()).toEqual(registry.getModels('openrouter'))
  })

  test('refreshes cannot mutate bundled defaults across registry resets', () => {
    const defaults = registry.getDefaultModels('anthropic')
    registry.updateProviderModels('anthropic', { fake: { name: 'Fake' } })
    registry.initProvidersPath(null)
    expect(registry.getProvider('anthropic').models).toEqual(defaults)
  })

  test('Anthropic offline refresh uses the same bundled catalog', async () => {
    expect(await refresh.fetchAnthropicModels()).toEqual(registry.getDefaultModels('anthropic'))
  })
})
