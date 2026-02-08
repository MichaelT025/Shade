import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

async function loadAdapter() {
  return await import('../rendering-adapter.js')
}

describe('rendering-adapter LaTeX compatibility', () => {
  let renderToString

  beforeEach(() => {
    vi.resetModules()

    globalThis.marked = {
      setOptions: vi.fn(),
      parse: vi.fn(input => input)
    }

    renderToString = vi.fn((latex, { displayMode }) => `<math data-display="${displayMode ? '1' : '0'}">${latex}</math>`)

    globalThis.katex = {
      renderToString
    }

    globalThis.DOMPurify = {
      sanitize: vi.fn(html => html)
    }
  })

  afterEach(() => {
    delete globalThis.marked
    delete globalThis.katex
    delete globalThis.DOMPurify
  })

  test('renders inline math with \\( ... \\) delimiters', async () => {
    const { renderMarkdownSafe } = await loadAdapter()

    const html = renderMarkdownSafe('Inline: \\(x^2 + y^2\\)')

    expect(html).toContain('<math data-display="0">x^2 + y^2</math>')
  })

  test('renders double-escaped display delimiters from Gemini-style output', async () => {
    const { renderMarkdownSafe } = await loadAdapter()

    const html = renderMarkdownSafe('Equation: \\\\[x^2 + y^2 = z^2\\\\]')

    expect(html).toContain('<math data-display="1">x^2 + y^2 = z^2</math>')
  })

  test('renders fenced latex blocks as display math', async () => {
    const { renderMarkdownSafe } = await loadAdapter()

    const html = renderMarkdownSafe('```latex\n\\frac{1}{2}\n```')

    expect(html).toContain('<math data-display="1">\\frac{1}{2}</math>')
  })

  test('preserves matrix line break markers', async () => {
    const { renderMarkdownSafe } = await loadAdapter()

    renderMarkdownSafe('$$\\begin{bmatrix}1\\\\2\\end{bmatrix}$$')

    expect(renderToString).toHaveBeenCalledWith(
      '\\begin{bmatrix}1\\\\2\\end{bmatrix}',
      expect.objectContaining({ displayMode: true })
    )
  })

  test('handles multiline parenthesized math blocks', async () => {
    const { renderMarkdownSafe } = await loadAdapter()

    renderMarkdownSafe('Start\n\\(\na+b\n\\)\nEnd')

    expect(renderToString).toHaveBeenCalledWith(
      'a+b',
      expect.objectContaining({ displayMode: false })
    )
  })
})
