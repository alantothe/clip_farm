import { Clapperboard, Sparkles } from 'lucide-react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { XToVerticalPage } from './features/x-to-vertical/XToVerticalPage'
import { ModesPage } from './pages/ModesPage'

function AppHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const isHome = location.pathname === '/'

  return (
    <header className="app-header">
      <button className="brand" onClick={() => navigate('/')} aria-label="Clip Farm modes home">
        <span className="brand__mark"><Clapperboard size={19} /></span>
        <strong>Clip Farm</strong>
      </button>
      {isHome ? (
        <div className="header-format header-format--home"><span>MODE</span><strong>LIBRARY</strong></div>
      ) : (
        <div className="header-format"><span>LANDSCAPE</span><i /><strong>9:16</strong></div>
      )}
      <div className="header-right"><Sparkles size={15} /><span>Vertical studio</span></div>
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
