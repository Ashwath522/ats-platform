import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { installApiBase } from './lib/api.js'
import { initNativeShell } from './lib/platform.js'

installApiBase()
initNativeShell()
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
import './tailwind.css'
import './styles.css'


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
