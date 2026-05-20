import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import './index.css'
import ConfigurationPage from './pages/ConfigurationPage.tsx'
import DashboardPage from './pages/DashboardPage.tsx'
import TopNavbar from './components/TopNavbar.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { getBootStatus } from './services/api'

function RootApp() {
  const [bootReady, setBootReady] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true

    const loadBootStatus = async () => {
      try {
        const status = await getBootStatus()
        if (active) {
          setBootReady(status.ready)
        }
      } catch (error) {
        console.error('[BOOT] Failed to load boot status:', error)
        if (active) {
          setBootReady(false)
        }
      }
    }

    void loadBootStatus()

    return () => {
      active = false
    }
  }, [])

  if (bootReady === null) {
    return (
      <div className="h-screen bg-[#0B0F14] text-white flex items-center justify-center">
        <div className="rounded-lg border border-gray-800 bg-[#11161D] px-4 py-3 text-sm text-gray-300">
          Loading EagleEye...
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <div className="h-screen overflow-hidden bg-[#0B0F14] flex flex-col">
        <TopNavbar />
        <Routes>
          <Route path="/" element={<Navigate to={bootReady ? '/dashboard' : '/configuration'} replace />} />
          <Route
            path="/configuration"
            element={bootReady ? <Navigate to="/dashboard" replace /> : <ConfigurationPage onMonitoringStarted={() => { window.location.href = '/dashboard' }} />}
          />
          <Route path="/dashboard" element={bootReady ? <DashboardPage /> : <Navigate to="/configuration" replace />} />
          <Route path="*" element={<Navigate to={bootReady ? '/dashboard' : '/configuration'} replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

// Global handlers to surface errors that occur before React mounts (module-level exceptions)
window.addEventListener('error', (ev) => {
  // eslint-disable-next-line no-console
  console.error('Global error captured:', ev.error ?? ev.message)
  try {
    const root = document.getElementById('root')
    if (root) {
      root.innerHTML = `<div style="background:#0B0F14;color:#fff;padding:24px;font-family:Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial;">
        <h2>Application error</h2>
        <pre style="white-space:pre-wrap;word-break:break-word;color:#f88;">${String((ev.error && ev.error.message) || ev.message)}</pre>
        <div style="color:#999;margin-top:12px">Open the browser console for details.</div>
      </div>`
    }
  } catch (e) {
    // ignore
  }
})

window.addEventListener('unhandledrejection', (ev) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled rejection:', ev.reason)
  try {
    const root = document.getElementById('root')
    if (root) {
      root.innerHTML = `<div style="background:#0B0F14;color:#fff;padding:24px;font-family:Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial;">
        <h2>Unhandled promise rejection</h2>
        <pre style="white-space:pre-wrap;word-break:break-word;color:#f88;">${String(ev.reason?.message ?? ev.reason)}</pre>
        <div style="color:#999;margin-top:12px">Open the browser console for details.</div>
      </div>`
    }
  } catch (e) {
    // ignore
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RootApp />
    </ErrorBoundary>
  </StrictMode>,
)
