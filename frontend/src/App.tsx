import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from './lib/api'
import type { DocumentOut } from './lib/types'
import { Activity, BarChart3, Building2, CalendarCheck, CalendarDays, CalendarRange, ClipboardList, FileSignature, FileText, FlaskConical, KeyRound as KeyIcon, LayoutDashboard, Plug, ShieldCheck, Settings2, Star, Users } from 'lucide-react'
import { useAuth } from './lib/auth'
import { ProShell } from './components/ProShell'
import { PowrotDoWizyty } from './components/PowrotDoWizyty'
import { Login } from './pages/Login'
import { Rejestracja } from './pages/Rejestracja'
import { PortalLayout } from './pages/PortalLayout'
import { Start } from './pages/Start'
import { Umow } from './pages/Umow'
import { Wizyty } from './pages/Wizyty'
import { Dokumentacja } from './pages/Dokumentacja'
import { Recepty } from './pages/Recepty'
import { SkierowaniaPacjenta } from './pages/SkierowaniaPacjenta'
import { Rodzina } from './pages/Rodzina'
import { Profil } from './pages/Profil'
import { RezerwacjaPubliczna } from './pages/RezerwacjaPubliczna'
import { PotwierdzWizyte } from './pages/PotwierdzWizyte'
import { ResetHasla } from './pages/ResetHasla'
import { FamilyProvider } from './lib/family'
import { I18nProvider } from './lib/i18n'
import { Telewizyta } from './pages/Telewizyta'
import { Udostepnij } from './pages/Udostepnij'
import { KodOdPacjenta } from './pages/KodOdPacjenta'
import { LekarzDzien } from './pages/lekarz/Dzien'
import { LekarzKalendarz } from './pages/lekarz/Kalendarz'
import { LekarzDokumenty } from './pages/lekarz/Dokumenty'
import { LekarzOpinie } from './pages/lekarz/Opinie'
import { Gabinet } from './pages/lekarz/Gabinet'
import { StaffPacjenci } from './pages/staff/Pacjenci'
import { PacjentRecord } from './pages/staff/PacjentRecord'
import { Skierowania } from './pages/pielegniarka/Skierowania'
import { Zabiegi } from './pages/pielegniarka/Zabiegi'
import { Toaster } from './components/Toaster'
import { ConfirmHost } from './components/ConfirmHost'
import { UmowWizyte } from './pages/poradnia/UmowWizyte'
import { Kalendarz } from './pages/poradnia/Kalendarz'
import { PacjenciPlacowki } from './pages/poradnia/Pacjenci'
import { Raporty } from './pages/poradnia/Raporty'
import { Pulpit } from './pages/poradnia/Pulpit'
import { Wyniki } from './pages/poradnia/Wyniki'
import { UstawieniaPlacowki } from './pages/poradnia/UstawieniaPlacowki'
import { AdminUzytkownicy } from './pages/admin/Uzytkownicy'
import { AdminPlacowki } from './pages/admin/Placowki'
import { AdminIntegracje } from './pages/admin/Integracje'
import { AdminMonitoring } from './pages/admin/Monitoring'
import { DziennikRodo } from './pages/admin/DziennikRodo'

function LekarzLayout() {
  return (
    <ProShell
      brand="Portal Lekarza"
      nav={[
        { to: '/', label: 'Mój dzień', icon: CalendarDays, end: true },
        { to: '/kalendarz', label: 'Kalendarz', icon: CalendarRange },
        { to: '/pacjenci', label: 'Pacjenci', icon: Users },
        { to: '/dokumenty', label: 'Dokumenty', icon: FileText },
        { to: '/opinie', label: 'Opinie', icon: Star },
        { to: '/kod', label: 'Kod od pacjenta', icon: FileSignature },
      ]}
    >
      <PowrotDoWizyty />
      <Outlet />
    </ProShell>
  )
}

function PielegniarkaLayout() {
  // marker „nowe skierowania": licznik czekających w kolejce, odświeżany w tle
  // (near-real-time) — ta sama queryKey co strona Skierowania, więc współdzielą cache
  const { data: referrals } = useQuery({
    queryKey: ['nursing-referrals'],
    queryFn: () => api<DocumentOut[]>('/referrals/nursing'),
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  })
  return (
    <ProShell
      brand="Portal Pielęgniarki"
      nav={[
        { to: '/', label: 'Zabiegi', icon: ClipboardList, end: true },
        { to: '/skierowania', label: 'Skierowania', icon: FileSignature, badge: referrals?.length },
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
        { to: '/placowki', label: 'Placówki', icon: Building2 },
        { to: '/integracje', label: 'Integracje', icon: Plug },
        { to: '/monitoring', label: 'Monitoring', icon: Activity },
        { to: '/rodo', label: 'Dziennik RODO', icon: ShieldCheck },
      ]}
    >
      <Outlet />
    </ProShell>
  )
}

function PoradniaLayout() {
  const { me } = useAuth()
  // Raporty/statystyki to wgląd zarządczy — widzi je kierownik, nie rejestracja.
  const canManage = me?.role === 'kierownik' || me?.role === 'administrator'
  return (
    <ProShell
      brand="Panel Poradni"
      nav={[
        { to: '/', label: 'Pulpit', icon: LayoutDashboard, end: true },
        { to: '/kalendarz', label: 'Kalendarz lekarzy', icon: CalendarDays },
        { to: '/umow', label: 'Umów wizytę', icon: CalendarCheck },
        { to: '/pacjenci', label: 'Pacjenci', icon: Users },
        { to: '/wyniki', label: 'Wyniki badań', icon: FlaskConical },
        ...(canManage ? [
          { to: '/ustawienia', label: 'Ustawienia placówki', icon: Settings2 },
          { to: '/raporty', label: 'Raporty', icon: BarChart3 },
        ] : []),
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
      <div className="flex min-h-screen items-center justify-center text-sm font-semibold text-gray-500">
        Wczytywanie…
      </div>
    )
  }

  const role = me?.role

  return (
    <>
    <Routes>
      <Route path="/login" element={token && me ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/rejestracja" element={<Rejestracja />} />
      {/* publiczna strona rezerwacji (M8.6) — bez logowania */}
      <Route path="/rezerwacja" element={<RezerwacjaPubliczna />} />
      <Route path="/potwierdz/:token" element={<PotwierdzWizyte />} />
      {/* teleporada gościa (bez logowania) — wejście z linka „Zarządzaj wizytą", ?vt=<token> */}
      <Route path="/teleporada/:id" element={<Telewizyta />} />
      <Route path="/reset-hasla" element={<ResetHasla />} />

      {!token && <Route path="*" element={<Navigate to="/login" replace />} />}
      {token && profileMissing && <Route path="*" element={<Navigate to="/rejestracja" replace />} />}

      {token && me && role === 'pacjent' && (
        <Route path="/" element={<I18nProvider><FamilyProvider><PortalLayout /></FamilyProvider></I18nProvider>}>
          <Route index element={<Start />} />
          <Route path="umow" element={<Umow />} />
          <Route path="wizyty" element={<Wizyty />} />
          <Route path="recepty" element={<Recepty />} />
          <Route path="skierowania" element={<SkierowaniaPacjenta />} />
          <Route path="dokumentacja" element={<Dokumentacja />} />
          <Route path="udostepnij" element={<Udostepnij />} />
          <Route path="rodzina" element={<Rodzina />} />
          <Route path="profil" element={<Profil />} />
          <Route path="telewizyta/:id" element={<Telewizyta />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}

      {token && me && role === 'lekarz' && (
        <Route path="/" element={<LekarzLayout />}>
          <Route index element={<LekarzDzien />} />
          <Route path="kalendarz" element={<LekarzKalendarz />} />
          <Route path="dokumenty" element={<LekarzDokumenty />} />
          <Route path="opinie" element={<LekarzOpinie />} />
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
          <Route index element={<Pulpit />} />
          <Route path="kalendarz" element={<Kalendarz />} />
          <Route path="umow" element={<UmowWizyte />} />
          <Route path="pacjenci" element={<PacjenciPlacowki />} />
          <Route path="pacjent/:id" element={<PacjentRecord />} />
          <Route path="wyniki" element={<Wyniki />} />
          {role === 'kierownik' && <Route path="ustawienia" element={<UstawieniaPlacowki />} />}
          {role === 'kierownik' && <Route path="raporty" element={<Raporty />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}

      {token && me && role === 'administrator' && (
        <Route path="/" element={<AdminLayout />}>
          <Route index element={<AdminUzytkownicy />} />
          <Route path="placowki" element={<AdminPlacowki />} />
          <Route path="integracje" element={<AdminIntegracje />} />
          <Route path="monitoring" element={<AdminMonitoring />} />
          <Route path="rodo" element={<DziennikRodo />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
    <Toaster />
    <ConfirmHost />
    </>
  )
}
