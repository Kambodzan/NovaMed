import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Activity, BarChart3, CalendarDays, CalendarRange, ClipboardList, FileSignature, KeyRound as KeyIcon, Plug, Users } from 'lucide-react'
import { useAuth } from './lib/auth'
import { ProShell } from './components/ProShell'
import { Login } from './pages/Login'
import { Rejestracja } from './pages/Rejestracja'
import { PortalLayout } from './pages/PortalLayout'
import { Start } from './pages/Start'
import { Umow } from './pages/Umow'
import { Wizyty } from './pages/Wizyty'
import { Dokumentacja } from './pages/Dokumentacja'
import { Rodzina } from './pages/Rodzina'
import { FamilyProvider } from './lib/family'
import { Telewizyta } from './pages/Telewizyta'
import { Udostepnij } from './pages/Udostepnij'
import { KodOdPacjenta } from './pages/KodOdPacjenta'
import { LekarzDzien } from './pages/lekarz/Dzien'
import { Gabinet } from './pages/lekarz/Gabinet'
import { StaffPacjenci } from './pages/staff/Pacjenci'
import { PacjentRecord } from './pages/staff/PacjentRecord'
import { Skierowania } from './pages/pielegniarka/Skierowania'
import { Zabiegi } from './pages/pielegniarka/Zabiegi'
import { Terminy } from './pages/poradnia/Terminy'
import { PacjenciPlacowki } from './pages/poradnia/Pacjenci'
import { Raporty } from './pages/poradnia/Raporty'
import { AdminUzytkownicy } from './pages/admin/Uzytkownicy'
import { AdminIntegracje } from './pages/admin/Integracje'
import { AdminMonitoring } from './pages/admin/Monitoring'

function LekarzLayout() {
  return (
    <ProShell
      brand="Portal Lekarza"
      nav={[
        { to: '/', label: 'Mój dzień', icon: CalendarDays, end: true },
        { to: '/pacjenci', label: 'Pacjenci', icon: Users },
        { to: '/kod', label: 'Kod od pacjenta', icon: FileSignature },
      ]}
    >
      <Outlet />
    </ProShell>
  )
}

function PielegniarkaLayout() {
  return (
    <ProShell
      brand="Portal Pielęgniarki"
      nav={[
        { to: '/', label: 'Zabiegi', icon: ClipboardList, end: true },
        { to: '/skierowania', label: 'Skierowania', icon: FileSignature },
        { to: '/pacjenci', label: 'Pacjenci', icon: Users },
        { to: '/kod', label: 'Kod od pacjenta', icon: KeyIcon },
      ]}
    >
      <Outlet />
    </ProShell>
  )
}

function AdminLayout() {
  return (
    <ProShell
      brand="Panel Administratora"
      nav={[
        { to: '/', label: 'Użytkownicy', icon: Users, end: true },
        { to: '/integracje', label: 'Integracje', icon: Plug },
        { to: '/monitoring', label: 'Monitoring', icon: Activity },
      ]}
    >
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
        { to: '/raporty', label: 'Raporty', icon: BarChart3 },
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
        <Route path="/" element={<FamilyProvider><PortalLayout /></FamilyProvider>}>
          <Route index element={<Start />} />
          <Route path="umow" element={<Umow />} />
          <Route path="wizyty" element={<Wizyty />} />
          <Route path="dokumentacja" element={<Dokumentacja />} />
          <Route path="udostepnij" element={<Udostepnij />} />
          <Route path="rodzina" element={<Rodzina />} />
          <Route path="telewizyta/:id" element={<Telewizyta />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}

      {token && me && role === 'lekarz' && (
        <Route path="/" element={<LekarzLayout />}>
          <Route index element={<LekarzDzien />} />
          <Route path="wizyta/:id" element={<Gabinet />} />
          <Route path="pacjenci" element={<StaffPacjenci />} />
          <Route path="pacjent/:id" element={<PacjentRecord />} />
          <Route path="kod" element={<KodOdPacjenta />} />
          <Route path="telewizyta/:id" element={<Telewizyta />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}

      {token && me && role === 'pielegniarka' && (
        <Route path="/" element={<PielegniarkaLayout />}>
          <Route index element={<Zabiegi />} />
          <Route path="skierowania" element={<Skierowania />} />
          <Route path="pacjenci" element={<StaffPacjenci />} />
          <Route path="pacjent/:id" element={<PacjentRecord />} />
          <Route path="kod" element={<KodOdPacjenta />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}

      {token && me && (role === 'rejestracja' || role === 'kierownik') && (
        <Route path="/" element={<PoradniaLayout />}>
          <Route index element={<Terminy />} />
          <Route path="pacjenci" element={<PacjenciPlacowki />} />
          <Route path="raporty" element={<Raporty />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}

      {token && me && role === 'administrator' && (
        <Route path="/" element={<AdminLayout />}>
          <Route index element={<AdminUzytkownicy />} />
          <Route path="integracje" element={<AdminIntegracje />} />
          <Route path="monitoring" element={<AdminMonitoring />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  )
}
