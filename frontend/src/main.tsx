import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import './index.css'
// import App from './App.tsx'
import ConfigurationPage from './pages/ConfigurationPage.tsx'
import DashboardPage from './pages/DashboardPage.tsx'
import TopNavbar from './components/TopNavbar.tsx'
import type { AppPage } from './components/TopNavbar.tsx'

function RootApp() {
  const [currentPage, setCurrentPage] = useState<AppPage>('configuration')

  return (
    <div className="h-screen overflow-hidden bg-[#0B0F14] flex flex-col">
      <TopNavbar currentPage={currentPage} />
      {currentPage === 'configuration' ? (
        <ConfigurationPage onMonitoringStarted={() => setCurrentPage('dashboard')} />
      ) : (
        <DashboardPage />
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
