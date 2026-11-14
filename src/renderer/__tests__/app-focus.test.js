import { describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

function createRevealFixture() {
  const source = fs.readFileSync(path.join(import.meta.dirname, '../app.js'), 'utf8')
  const start = source.indexOf('  window.electronAPI.onWindowShown?.(() => {')
  const end = source.indexOf('  // Input typing handler:', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)

  const messageInput = { disabled: false, focus: vi.fn() }
  const root = { style: { display: '' }, offsetHeight: 450 }
  const onWindowShown = vi.fn()
  const context = {
    console: { log: vi.fn() }, Date, setTimeout: vi.fn(),
    document: {
      hidden: false,
      body: { classList: { add: vi.fn(), remove: vi.fn() } },
      getElementById: vi.fn(() => root)
    },
    window: { electronAPI: { onWindowShown } },
    messageInput,
    setVisualEffectsEnabled: vi.fn()
  }
  vm.runInNewContext(source.slice(start, end), context)
  return { messageInput, onWindowShown }
}

describe('composer focus when Shade is revealed', () => {
  test('requests composer focus on each show', () => {
    const { messageInput, onWindowShown } = createRevealFixture()
    const reveal = onWindowShown.mock.calls[0][0]

    reveal()
    reveal()

    expect(messageInput.focus).toHaveBeenCalledTimes(2)
    expect(messageInput.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  test('does not focus the composer while it is disabled', () => {
    const { messageInput, onWindowShown } = createRevealFixture()
    messageInput.disabled = true

    onWindowShown.mock.calls[0][0]()

    expect(messageInput.focus).not.toHaveBeenCalled()
  })
})

describe('explicit composer focus while Shade is already visible', () => {
  test.each([false, true])('respects composer disabled=%s', (disabled) => {
    const source = fs.readFileSync(path.join(import.meta.dirname, '../app.js'), 'utf8')
    const start = source.indexOf('  window.electronAPI.onFocusComposer(')
    const end = source.indexOf('\n  })', start) + '\n  })'.length
    expect(start).toBeGreaterThan(-1)
    let focusComposer
    const messageInput = { disabled, focus: vi.fn() }
    vm.runInNewContext(source.slice(start, end), {
      window: { electronAPI: { onFocusComposer: callback => { focusComposer = callback } } },
      messageInput
    })
    focusComposer()
    expect(messageInput.focus).toHaveBeenCalledTimes(disabled ? 0 : 1)
  })
})
