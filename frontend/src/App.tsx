import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { CalendarDays, CalendarRange, ClipboardList, Users } from 'lucide-react'
import { useAuth } from './lib/auth'
import { ProShell } from './components/ProShell'
import { Login } from './pages/Login'
import { Rejestracja } from './pages/Rejestracja'
import { PortalLayout } from './pages/PortalLayout'
import { Start } from './pages/Start'
import { Umow } from './pages/Umow'
import { Wizyty } from './pages/Wizyty'
import { Dokumentacja } from './pages/Dokumentacja'
import { LekarzDzien } from './pages/lekarz/Dzien'
import { Skierowania } from './pages/pielegniarka/Skierowania'
import { Terminy } from './pages/poradnia/Terminy'
import { PacjenciPlacowki } from './pages/poradnia/Pacjenci'

function LekarzLayout() {
  return (
    <ProShell brand="Portal Lekarza" nav={[{ to: '/', label: 'Mój dzień', icon: CalendarDays, end: true }]}>
      <Outlet />
    </ProShell>
  )
}

function PielegniarkaLayout() {
  return (
    <ProShell brand="Portal Pielęgniarki" nav={[{ to: '/', label: 'Skierowania', icon: ClipboardList, end: true }]}>
      <Outlet />
    </ProShell>
  )
}

function PoradniaLayout() {
  return (
    <ProShell
      brand="Panel Poradni"
      nav={[
        { to: '/', label: 'Terminy', icon: CalendarRange, end: true },
        { to: '/pacjenci', label: 'Pacjenci placówki', icon: Users },
      ]}
    >
      <Outlet />
    </ProShell>
  )
}

export default function App() {
  const { token, me, profileMissing, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm font-semibold text-gray-400">
        Wczytywanie…
      </div>
    )
  }

  const role = me?.role

  return (
    <Routes>
      <Route path="/login" element={token && me ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/rejestracja" element={<Rejestracja />} />

      {!token && <Route path="*" element={<Navigate to="/login" replace />} />}
      {token && profileMissing && <Route path="*" element={<Navigate to="/rejestracja" replace />} />}

      {token && me && role === 'pacjent' && (
        <Route path="/" element={<PortalLayout />}>
          <Route index element={<Start />} />
          <Route path="umow" element={<Umow />} />
          <Route path="wizyty" element={<Wizyty />} />
          <Route path="dokumentacja" element={<Dokumentacja />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}

      {token && me && role === 'lekarz' && (
        <Route path="/" element={<LekarzLayout />}>
          <Route index element={<LekarzDzien />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}

      {token && me && role === 'pielegniarka' && (
        <Route path="/" element={<PielegniarkaLayout />}>
          <Route index element={<Skierowania />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}

      {token && me && (role === 'rejestracja' || role === 'kierownik') && (
        <Route path="/" element={<PoradniaLayout />}>
          <Route index element={<Terminy />} />
          <Route path="pacjenci" element={<PacjenciPlacowki />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}

      {token && me && role === 'administrator' && (
        <Route
          path="*"
          element={
            <div className="flex min-h-screen flex-col items-center justify-center gap-2 text-center">
              <p className="text-lg font-extrabold text-gray-900">Panel Administratora — wkrótce</p>
              <p className="max-w-sm text-sm font-medium text-gray-500">
                Zarządzanie użytkownikami, integracjami i monitoringiem wejdzie w milestone M8.
              </p>
            </div>
          }
        />
      )}
    </Routes>
  )
}
