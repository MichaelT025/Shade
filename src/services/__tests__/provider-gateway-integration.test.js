import { describe, it, expect, vi, afterEach } from 'vitest'
import { capabilityLabel } from '../../renderer/utils/provider-capabilities.js'
const Factory = (await import('../llm-factory.js')).default
const refresh = (await import('../model-refresh.js')).default
const registry = (await import('../provider-registry.js')).default

afterEach(() => vi.restoreAllMocks())

describe('gateway integration', () => {
  it('preserves the existing default provider', () => {
    expect(registry.getProviderIds()[0]).toBe('gemini')
  })
  it('resolves legacy Flash IDs and uses authoritative endpoint and capabilities', () => {
    const provider = Factory.createProvider('deepseek', 'key', {
      model: 'deepseek-v4-flash-vision-exp', baseUrl: 'https://invalid.example',
      capabilities: { vision: false }, protocol: 'invalid'
    })
    expect(provider.config.model).toBe('deepseek-flash')
    expect(provider.config.baseUrl).toBe('https://api.deepseek.com')
    expect(provider.config.capabilities.vision).toBe(true)
    expect(provider.config.protocol).toBe('openai-chat-completions')
  })
  it('rejects unavailable Go and unknown gateway models', () => {
    expect(() => Factory.createProvider('opencode-go', 'key')).toThrow('pending confirmation')
    expect(() => Factory.createProvider('opencode-zen', 'key', { model: 'unknown' })).toThrow('unavailable')
  })
  it('refreshes availability with bundled capability metadata when metadata is offline', async () => {
    const request = vi.spyOn(refresh, 'httpsRequest')
      .mockResolvedValueOnce(JSON.stringify({ data: [{ id: 'claude-sonnet-4-5' }, { id: 'unknown' }] }))
      .mockRejectedValueOnce(new Error('offline'))
    const models = await refresh.fetchGatewayModels('opencode-zen', registry.getProvider('opencode-zen'), 'secret')
    expect(Object.keys(models)).toEqual(['claude-sonnet-4-5'])
    expect(models['claude-sonnet-4-5'].capabilities.vision).toBe(true)
    expect(request.mock.calls[1]).toEqual(['https://models.dev/api.json'])
  })
  it('does not echo credentials or catalog error bodies', async () => {
    vi.spyOn(refresh, 'httpsRequest').mockRejectedValue(new Error('HTTP 401 secret'))
    await expect(refresh.fetchGatewayModels('deepseek', registry.getProvider('deepseek'), 'secret'))
      .rejects.toThrow('existing list was kept')
  })
  it('distinguishes supported, unsupported and unverified screenshot models', () => {
    const provider = { strictCapabilities: true }
    expect(capabilityLabel({ capabilities: { vision: true } }, provider)).toBe('Screenshots supported')
    expect(capabilityLabel({ capabilities: { vision: false } }, provider)).toBe('Text only')
    expect(capabilityLabel({}, provider)).toBe('Screenshot support unverified')
    expect(capabilityLabel({}, {})).toBe('')
  })
})
