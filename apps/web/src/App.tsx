import { Clapperboard, Settings, Sparkles } from 'lucide-react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { BatchProcessPage } from './features/batch-process/BatchProcessPage'
import { XToVerticalPage } from './features/x-to-vertical/XToVerticalPage'
import { ModesPage } from './pages/ModesPage'
import { SettingsPage } from './pages/SettingsPage'

function AppHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const isHome = location.pathname === '/'
  const isSettings = location.pathname === '/settings'
  const isBatch = location.pathname.startsWith('/modes/batch-process')

  return (
    <header className="app-header">
      <button className="brand" onClick={() => navigate('/')} aria-label="Clip Farm modes home">
        <span className="brand__mark"><Clapperboard size={19} /></span>
        <strong>Clip Farm</strong>
      </button>
      {isSettings ? (
        <div className="header-format header-format--home"><span>ACCOUNT</span><strong>CONNECTIONS</strong></div>
      ) : isHome ? (
        <div className="header-format header-format--home"><span>MODE</span><strong>LIBRARY</strong></div>
      ) : isBatch ? (
        <div className="header-format"><span>BATCH</span><i /><strong>9:16</strong></div>
      ) : (
        <div className="header-format"><span>LANDSCAPE</span><i /><strong>9:16</strong></div>
      )}
      <div className="header-right">
        {!isSettings && <><Sparkles size={15} /><span>Vertical studio</span></>}
        <button
          className={`header-settings ${isSettings ? 'is-active' : ''}`}
          type="button"
          onClick={() => navigate('/settings')}
          aria-label="Open settings"
        >
          <Settings size={16} />
          <span>Settings</span>
        </button>
      </div>
    </header>
  )
}

export function App() {
  return (
    <div className="app-shell">
      <AppHeader />
      <Routes>
        <Route path="/" element={<ModesPage />} />
        <Route path="/modes/x-to-vertical" element={<XToVerticalPage />} />
        <Route path="/modes/x-to-vertical/new" element={<XToVerticalPage createNew />} />
        <Route path="/modes/x-to-vertical/projects/:projectId" element={<XToVerticalPage />} />
        <Route path="/modes/batch-process" element={<BatchProcessPage />} />
        <Route path="/modes/batch-process/batches/:batchId" element={<BatchProcessPage />} />
        <Route
          path="/modes/batch-process/batches/:batchId/clips/:clipId"
          element={<BatchProcessPage />}
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
