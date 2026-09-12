import { describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/**
 * The dashboard renderer is a browser script (it uses `window` and `document`
 * at module scope), and this suite runs in the node environment without a DOM.
 * To still regression-test the session-card keyboard routing (BUG-10), this
 * file extracts the real `keydown` listener source from homepage.js and
 * executes it against synthetic events.
 */
function extractCardKeydownListener() {
  const file = path.join(import.meta.dirname, '../homepage.js')
  const source = fs.readFileSync(file, 'utf8')

  const startMarker = "card.addEventListener('keydown', "
  const endMarker = "card.addEventListener('contextmenu', "
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)

  const segment = source.slice(start + startMarker.length, end).trim()
  // Drop the trailing `)` that closes the addEventListener() call so only the
  // arrow function source remains.
  const arrowSource = segment.replace(/\)$/, '')
  expect(arrowSource.startsWith('(')).toBe(true)

  const card = { tagName: 'DIV' }
  const activate = vi.fn()
  const listener = vm.runInNewContext(arrowSource, { card, activate })
  expect(typeof listener).toBe('function')

  return { listener, card, activate }
}

function syntheticKeyEvent(key, target, overrides = {}) {
  return {
    key,
    target,
    preventDefault: vi.fn(),
    ...overrides
  }
}

describe('session-card keyboard routing (BUG-10)', () => {
  test('Enter on the card itself activates the card', () => {
    const { listener, card, activate } = extractCardKeydownListener()
    const event = syntheticKeyEvent('Enter', card)

    listener(event)

    expect(activate).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  test('Space on the card itself activates the card', () => {
    const { listener, card, activate } = extractCardKeydownListener()
    const event = syntheticKeyEvent(' ', card)

    listener(event)

    expect(activate).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  test('Enter on a focused child button performs the child action instead of activating the card', () => {
    const { listener, card, activate } = extractCardKeydownListener()
    const renameButton = { tagName: 'BUTTON' }
    const event = syntheticKeyEvent('Enter', renameButton)

    listener(event)

    expect(activate).not.toHaveBeenCalled()
    // Native keyboard activation must not be suppressed for child controls.
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  test('Space on a focused child checkbox toggles the checkbox instead of activating the card', () => {
    const { listener, card, activate } = extractCardKeydownListener()
    const checkbox = { tagName: 'INPUT', type: 'checkbox' }
    const event = syntheticKeyEvent(' ', checkbox)

    listener(event)

    expect(activate).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  test('non-activation keys on the card do nothing', () => {
    const { listener, card, activate } = extractCardKeydownListener()
    const event = syntheticKeyEvent('Tab', card)

    listener(event)

    expect(activate).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
