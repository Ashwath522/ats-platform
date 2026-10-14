import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { installApiBase } from './lib/api.js'
import { initNativeShell } from './lib/platform.js'

installApiBase()
initNativeShell()
if ('serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.()) {
  // When a new service worker takes over (new deploy), reload once so the page uses the new build.
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; window.location.reload() } })
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {})
}
import './tailwind.css'
import './styles.css'


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
