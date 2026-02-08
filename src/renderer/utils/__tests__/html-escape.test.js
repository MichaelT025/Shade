import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../html-escape.js'

describe('escapeHtml', () => {
  it('escapes session-title style payloads', () => {
    const raw = '<img src=x onerror=alert(1)>'
    expect(escapeHtml(raw)).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('escapes provider-label style payloads', () => {
    const raw = 'OpenAI "GPT" <script>alert(1)</script>'
    expect(escapeHtml(raw)).toBe('OpenAI &quot;GPT&quot; &lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes error-message style payloads', () => {
    const raw = "Bad key: ' OR 1=1 -- <b>boom</b>"
    expect(escapeHtml(raw)).toBe('Bad key: &#39; OR 1=1 -- &lt;b&gt;boom&lt;/b&gt;')
  })

  it('handles nullish values safely', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})
