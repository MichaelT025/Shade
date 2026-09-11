export function capabilityLabel(model, provider) {
  if (!provider?.strictCapabilities) return ''
  const vision = model?.capabilities?.vision
  return vision === true ? 'Screenshots supported' : vision === false ? 'Text only' : 'Screenshot support unverified'
}
