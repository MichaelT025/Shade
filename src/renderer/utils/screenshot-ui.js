export function setupScreenshotPreview(element, paramsOrGetter, getScreenshot) {
  let popup = null
  let isHovering = false
  let hideTimeout = null
  let fetchPromise = null

  const getParams = () => {
    return typeof paramsOrGetter === 'function' ? paramsOrGetter() : paramsOrGetter
  }

  const showPopup = async () => {
    if (popup) return

    const params = getParams()
    if (!params) return

    let imgSrc = params.base64

    if (!imgSrc && params.sessionId && params.screenshotPath && typeof getScreenshot === 'function') {
      if (!fetchPromise) {
        fetchPromise = getScreenshot(params.sessionId, params.screenshotPath)
      }

      try {
        const result = await fetchPromise
        if (result.success && result.base64) {
          imgSrc = result.base64
        }
      } catch (error) {
        console.error('Failed to fetch screenshot preview', error)
        return
      }
    }

    if (!imgSrc || !isHovering) return

    popup = document.createElement('div')
    popup.className = 'screenshot-preview-popup'

    Object.assign(popup.style, {
      position: 'fixed',
      zIndex: '9999',
      background: 'var(--bg-secondary)',
      border: '2px solid var(--accent)',
      borderRadius: 'var(--radius-md)',
      padding: '4px',
      boxShadow: 'var(--shadow-glow), var(--shadow-elev-3)',
      width: '240px',
      height: 'auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: '0',
      transform: 'translateY(10px) scale(0.98)',
      transformOrigin: 'bottom center',
      transition: 'opacity 0.2s ease, transform 0.2s ease',
      backdropFilter: 'var(--blur-overlay)',
      webkitBackdropFilter: 'var(--blur-overlay)'
    })

    const img = document.createElement('img')
    img.src = `data:image/jpeg;base64,${imgSrc}`

    Object.assign(img.style, {
      maxWidth: '100%',
      maxHeight: '100%',
      borderRadius: '0',
      display: 'block',
      border: '1px solid var(--accent-muted)'
    })

    popup.appendChild(img)
    document.body.appendChild(popup)

    popup.addEventListener('mouseenter', () => {
      isHovering = true
      if (hideTimeout) clearTimeout(hideTimeout)
    })

    popup.addEventListener('mouseleave', () => {
      isHovering = false
      hidePopup()
    })

    const rect = element.getBoundingClientRect()
    const popupRect = popup.getBoundingClientRect()

    const top = Math.max(10, rect.top - popupRect.height - 12)
    let left = rect.left + (rect.width / 2) - (popupRect.width / 2)

    if (left < 10) left = 10
    if (left + popupRect.width > window.innerWidth - 10) {
      left = window.innerWidth - popupRect.width - 10
    }

    popup.style.top = `${top}px`
    popup.style.left = `${left}px`

    requestAnimationFrame(() => {
      if (popup) {
        popup.style.opacity = '1'
        popup.style.transform = 'translateY(0) scale(1)'
      }
    })
  }

  const hidePopup = () => {
    if (hideTimeout) clearTimeout(hideTimeout)
    hideTimeout = setTimeout(() => {
      if (!isHovering && popup) {
        popup.remove()
        popup = null
      }
    }, 150)
  }

  element.addEventListener('mouseenter', () => {
    isHovering = true
    if (hideTimeout) clearTimeout(hideTimeout)
    setTimeout(() => {
      if (isHovering) showPopup()
    }, 200)
  })

  element.addEventListener('mouseleave', () => {
    isHovering = false
    hidePopup()
  })
}

export function clearScreenshotChip() {
  const existingChip = document.getElementById('screenshot-chip')
  if (existingChip) {
    existingChip.remove()
  }
}
