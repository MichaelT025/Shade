import { describe, it, expect, vi, afterEach } from 'vitest'

const modelRefresh = (await import('../model-refresh.js')).default

afterEach(() => {
  vi.restoreAllMocks()
})

describe('model-refresh parse resilience', () => {
  it('returns empty models for malformed OpenAI response', async () => {
    vi.spyOn(modelRefresh, 'httpsRequest').mockResolvedValue('{bad json')
    const models = await modelRefresh.fetchOpenAIModels('test-key')
    expect(models).toEqual({})
  })

  it('returns empty models for malformed Gemini response', async () => {
    vi.spyOn(modelRefresh, 'httpsRequest').mockResolvedValue('{bad json')
    const models = await modelRefresh.fetchGeminiModels('test-key')
    expect(models).toEqual({})
  })

  it('returns empty models for malformed OpenRouter response', async () => {
    vi.spyOn(modelRefresh, 'httpsRequest').mockResolvedValue('{bad json')
    const models = await modelRefresh.fetchOpenRouterModels('test-key')
    expect(models).toEqual({})
  })
})
