import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

const { writeFileAtomicSync, writeFileAtomic } = await import('../atomic-write.js')

describe('atomic-write', () => {
  const testDir = path.join('/tmp/shade-atomic-write-test')
  const filePath = path.join(testDir, 'file.json')

  beforeEach(() => {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true })
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  })

  afterEach(() => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  })

  it('writes text atomically (sync)', () => {
    writeFileAtomicSync(filePath, '{"a":1}', 'utf8')
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"a":1}')
  })

  it('writes text atomically (async)', async () => {
    await writeFileAtomic(filePath, '{"b":2}', 'utf8')
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"b":2}')
  })

  it('writes buffers atomically (async)', async () => {
    const payload = Buffer.from([1, 2, 3, 4])
    await writeFileAtomic(filePath, payload)
    const saved = fs.readFileSync(filePath)
    expect(Array.from(saved)).toEqual([1, 2, 3, 4])
  })
})
