export function wireSocialLinks({ openExternal }) {
  document.querySelectorAll('.sidebar .social-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      const url = link.getAttribute('href')
      if (url && url !== '#') {
        openExternal(url)
      }
    })
  })
}

export function wireNavigation({
  checkFirstRunState,
  showFirstRunExperience,
  showView,
  loadSessions,
  initModesView,
  initConfigurationView,
  getModesViewInitialized,
  getConfigViewInitialized
}) {
  const navSessions = document.getElementById('nav-sessions')
  const navModes = document.getElementById('nav-modes')
  const navConfiguration = document.getElementById('nav-configuration')
  const navShortcuts = document.getElementById('nav-shortcuts')

  if (navSessions) {
    navSessions.addEventListener('click', async () => {
      const isFirstRun = await checkFirstRunState()
      if (isFirstRun) {
        showFirstRunExperience()
        return
      }

      navSessions.classList.add('active')
      navModes?.classList.remove('active')
      navConfiguration?.classList.remove('active')
      navShortcuts?.classList.remove('active')
      showView('view-sessions')
      loadSessions().catch(console.error)
    })
  }

  if (navModes) {
    navModes.addEventListener('click', async () => {
      navSessions?.classList.remove('active')
      navConfiguration?.classList.remove('active')
      navShortcuts?.classList.remove('active')
      navModes.classList.add('active')
      showView('view-modes')
      if (!getModesViewInitialized()) {
        await initModesView()
      }
    })
  }

  if (navConfiguration) {
    navConfiguration.addEventListener('click', async () => {
      navSessions?.classList.remove('active')
      navModes?.classList.remove('active')
      navShortcuts?.classList.remove('active')
      navConfiguration.classList.add('active')
      showView('view-configuration')
      if (!getConfigViewInitialized()) {
        await initConfigurationView()
      }
    })
  }

  if (navShortcuts) {
    navShortcuts.addEventListener('click', () => {
      navSessions?.classList.remove('active')
      navModes?.classList.remove('active')
      navConfiguration?.classList.remove('active')
      navShortcuts.classList.add('active')
      showView('view-shortcuts')
    })
  }
}
