/**
 * Native-shell glue for the Capacitor Android / iOS app. Everything here is a
 * no-op on the web, so the same bundle runs in a browser and inside the app.
 */
import { Capacitor } from '@capacitor/core'

export const isNative = Capacitor.isNativePlatform()
export const platform = Capacitor.getPlatform() // 'web' | 'android' | 'ios'

export async function initNativeShell() {
  const root = document.documentElement
  root.dataset.platform = platform
  if (!isNative) return

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Dark })
    if (platform === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0B1F33' })
    }
  } catch (e) { /* plugin optional */ }

  try {
    const { App } = await import('@capacitor/app')
    // Android hardware back button: go back in history, exit on root screens.
    App.addListener('backButton', ({ canGoBack }) => {
      const roots = ['/', '/candidate/feed', '/recruiter/home', '/candidate/login']
      if (canGoBack && !roots.includes(window.location.pathname)) {
        window.history.back()
      } else {
        App.exitApp()
      }
    })
    // Deep links such as corelink://candidate/repo?interview=12 or https links
    App.addListener('appUrlOpen', ({ url }) => {
      try {
        const u = new URL(url)
        const path = u.protocol.startsWith('http') ? `${u.pathname}${u.search}` : `/${u.host}${u.pathname}${u.search}`
        window.history.pushState({}, '', path)
        window.dispatchEvent(new PopStateEvent('popstate'))
      } catch (e) { /* ignore malformed */ }
    })
  } catch (e) { /* plugin optional */ }

  try {
    const { Keyboard } = await import('@capacitor/keyboard')
    Keyboard.addListener('keyboardWillShow', () => root.classList.add('keyboard-open'))
    Keyboard.addListener('keyboardWillHide', () => root.classList.remove('keyboard-open'))
  } catch (e) { /* plugin optional */ }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    setTimeout(() => SplashScreen.hide(), 250)
  } catch (e) { /* plugin optional */ }
}

export async function haptic(kind = 'light') {
  if (!isNative) {
    if (navigator.vibrate) navigator.vibrate(kind === 'heavy' ? 20 : 8)
    return
  }
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : ImpactStyle.Light })
  } catch (e) { /* ignore */ }
}
