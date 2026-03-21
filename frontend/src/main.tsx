import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import ConfigurationPage from './pages/ConfigurationPage.tsx'
import DashboardPage from './pages/DashboardPage.tsx'
import TopNavbar from './components/TopNavbar.tsx'
import { useState } from 'react'

function RootApp() {
  const [currentPage, setCurrentPage] = useState<'configuration' | 'dashboard'>('configuration')

  return (
    <BrowserRouter>
      <div className="h-screen overflow-hidden bg-[#0B0F14] flex flex-col">
        <TopNavbar currentPage={currentPage} />
        <Routes>
          <Route 
            path="/" 
            element={<ConfigurationPage onMonitoringStarted={() => {
              setCurrentPage('dashboard')
              window.location.href = '/dashboard'
            }} />} 
          />
          <Route
            path="/configuration"
            element={<ConfigurationPage onMonitoringStarted={() => {
              setCurrentPage('dashboard')
              window.location.href = '/dashboard'
            }} />}
          />
          <Route 
            path="/dashboard" 
            element={<DashboardPage onBackToConfig={() => {
              setCurrentPage('configuration')
              window.location.href = '/'
            }} />} 
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
