let markedConfigured = false

function getMarked() {
  return typeof globalThis !== 'undefined' && globalThis.marked ? globalThis.marked : null
}

function getDOMPurify() {
  return typeof globalThis !== 'undefined' && globalThis.DOMPurify ? globalThis.DOMPurify : null
}

function getKatex() {
  return typeof globalThis !== 'undefined' && globalThis.katex ? globalThis.katex : null
}

function getHighlightJs() {
  return typeof globalThis !== 'undefined' && globalThis.hljs ? globalThis.hljs : null
}

function ensureMarkedConfigured() {
  const markedLib = getMarked()
  if (!markedLib || markedConfigured) {
    return
  }

  markedLib.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    highlight(code, lang) {
      return highlightCodeSafe(code, lang)
    }
  })

  markedConfigured = true
}

function normalizeLatexBackslashes(latex) {
  if (!latex.includes('\\')) {
    return latex
  }

  // Only normalize escaped delimiters. Do not rewrite generic commands,
  // since patterns like matrix line breaks (\\) are valid LaTeX.
  return latex
    .replace(/\\\\\[/g, '\\[')
    .replace(/\\\\\]/g, '\\]')
    .replace(/\\\\\(/g, '\\(')
    .replace(/\\\\\)/g, '\\)')
}

function extractLatexBlocks(text) {
  const blocks = []
  let placeholderIndex = 0

  const patterns = [
    { regex: /```(?:latex|tex|math)\s*\r?\n([\s\S]*?)```/gi, displayMode: true },
    { regex: /\$\$([\s\S]*?)\$\$/g, displayMode: true },
    { regex: /(?:\\\\|\\)\[([\s\S]*?)(?:\\\\|\\)\]/g, displayMode: true },
    { regex: /(?:\\\\|\\)\(([\s\S]*?)(?:\\\\|\\)\)/g, displayMode: false },
    { regex: /(?<!\$)\$(?!\$)([^\$\n]+?)\$/g, displayMode: false }
  ]

  let output = text
  for (const pattern of patterns) {
    output = output.replace(pattern.regex, (_match, rawLatex) => {
      const placeholder = `%%LATEX_BLOCK_${placeholderIndex}%%`
      blocks.push({
        placeholder,
        latex: typeof rawLatex === 'string' ? rawLatex : '',
        displayMode: pattern.displayMode
      })
      placeholderIndex += 1
      return placeholder
    })
  }

  return { text: output, blocks }
}

export function renderLatexSafe(rawLatex, displayMode = false) {
  const katexLib = getKatex()
  if (!katexLib) {
    return (rawLatex || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  const latex = normalizeLatexBackslashes((rawLatex || '').trim())

  try {
    return katexLib.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false
    })
  } catch {
    return (rawLatex || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

function restoreAndRenderLatex(html, blocks) {
  let output = html

  for (const block of blocks) {
    output = output.replace(block.placeholder, renderLatexSafe(block.latex, !!block.displayMode))
  }

  return output
}

export function highlightCodeSafe(code, lang) {
  const hljsLib = getHighlightJs()
  if (!hljsLib) {
    return code
  }

  if (lang && hljsLib.getLanguage(lang)) {
    try {
      return hljsLib.highlight(code, { language: lang }).value
    } catch {
      return code
    }
  }

  try {
    return hljsLib.highlightAuto(code).value
  } catch {
    return code
  }
}

export function renderMarkdownSafe(text) {
  ensureMarkedConfigured()

  const markedLib = getMarked()
  const input = typeof text === 'string' ? text : ''
  if (!markedLib) {
    return input
  }

  try {
    const { text: textWithPlaceholders, blocks } = extractLatexBlocks(input)
    let html = markedLib.parse(textWithPlaceholders)
    html = restoreAndRenderLatex(html, blocks)

    const purifier = getDOMPurify()
    if (!purifier) {
      return html
    }

    return purifier.sanitize(html, {
      ADD_TAGS: ['semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mroot', 'msqrt', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace', 'mover', 'munder', 'munderover', 'math'],
      ADD_ATTR: ['mathvariant', 'encoding', 'xmlns', 'display', 'accent', 'accentunder', 'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'aria-hidden']
    })
  } catch {
    return input
  }
}
