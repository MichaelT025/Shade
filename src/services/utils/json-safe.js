function safeParseJson(input, fallback = null) {
  if (typeof input !== 'string') {
    return fallback
  }

  try {
    return JSON.parse(input)
  } catch {
    return fallback
  }
}

module.exports = {
  safeParseJson
}
