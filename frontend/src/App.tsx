import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { Login } from './pages/Login'
import { Rejestracja } from './pages/Rejestracja'
import { PortalLayout } from './pages/PortalLayout'
import { Start } from './pages/Start'
import { Umow } from './pages/Umow'
import { Wizyty } from './pages/Wizyty'
import { Dokumentacja } from './pages/Dokumentacja'

export default function App() {
  const { token, me, profileMissing, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm font-semibold text-gray-400">
        Wczytywanie…
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={token && me ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/rejestracja" element={<Rejestracja />} />
      <Route
        path="/"
        element={
          !token ? <Navigate to="/login" replace />
          : profileMissing ? <Navigate to="/rejestracja" replace />
          : <PortalLayout />
        }
      >
        <Route index element={<Start />} />
        <Route path="umow" element={<Umow />} />
        <Route path="wizyty" element={<Wizyty />} />
        <Route path="dokumentacja" element={<Dokumentacja />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
