import { describe, it, expect } from 'vitest'

const { safeParseJson } = await import('../json-safe.js')

describe('safeParseJson', () => {
  it('parses valid json', () => {
    expect(safeParseJson('{"ok":true}', null)).toEqual({ ok: true })
  })

  it('returns fallback on malformed json', () => {
    expect(safeParseJson('{invalid', { fallback: true })).toEqual({ fallback: true })
  })

  it('returns fallback for non-string input', () => {
    expect(safeParseJson(undefined, [])).toEqual([])
  })
})
