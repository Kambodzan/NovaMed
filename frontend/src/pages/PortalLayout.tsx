import { NavLink, Outlet } from 'react-router-dom'
import { HeartPulse, LogOut } from 'lucide-react'
import { cx } from '../ui'
import { useAuth } from '../lib/auth'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { NotificationsBell } from '../components/NotificationsBell'

const navItems = [
  { to: '/', label: 'Start' },
  { to: '/umow', label: 'Umów wizytę' },
  { to: '/wizyty', label: 'Moje wizyty' },
  { to: '/dokumentacja', label: 'Dokumentacja' },
  { to: '/udostepnij', label: 'Udostępnij' },
  { to: '/rodzina', label: 'Rodzina' },
]

export function PortalLayout() {
  const { me, logout } = useAuth()
  const { dependents, activeId, setActiveId, active } = useFamily()
  const { lang, setLang, t } = useI18n()

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white">
            <HeartPulse size={21} />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-gray-900">NovaMed</span>
        </div>
        <nav className="tile-shadow flex flex-wrap items-center gap-1 rounded-full bg-surface p-1.5" aria-label={t('Nawigacja')}>
          {navItems.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => cx(
                'rounded-full px-4 py-1.5 text-sm transition-colors',
                isActive ? 'bg-primary-soft font-extrabold text-primary' : 'font-semibold text-gray-500 hover:text-gray-900',
              )}
            >
              {t(n.label)}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLang(lang === 'pl' ? 'en' : 'pl')}
            aria-label={lang === 'pl' ? 'Switch to English' : 'Przełącz na polski'}
            className="tile-shadow cursor-pointer rounded-full bg-surface px-3 py-2 text-xs font-extrabold tracking-wider text-gray-500 uppercase hover:text-gray-900"
          >
            {lang === 'pl' ? 'EN' : 'PL'}
          </button>
          {dependents.length > 0 ? (
            <select
              aria-label={t('Aktywny profil')}
              className={cx(
                'tile-shadow cursor-pointer rounded-full bg-surface px-3.5 py-2 text-sm font-bold text-gray-700 outline-none',
                activeId !== null && 'ring-2 ring-amber-400',
              )}
              value={activeId ?? ''}
              onChange={e => setActiveId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{me?.first_name ? `${me.first_name} ${me.last_name}` : 'Ja'}</option>
              {dependents.map(d => (
                <option key={d.patient_id} value={d.patient_id}>{d.first_name} {d.last_name}</option>
              ))}
            </select>
          ) : (
            <span className="hidden text-sm font-bold text-gray-700 sm:inline">
              {me?.first_name ? `${me.first_name} ${me.last_name}` : me?.email}
            </span>
          )}
          <NotificationsBell />
          <button
            onClick={() => void logout()}
            aria-label={t('Wyloguj')}
            className="tile-shadow cursor-pointer rounded-full bg-surface p-2.5 text-gray-500 hover:text-gray-900"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      {active && (
        <p className="mb-1 rounded-xl bg-amber-50 px-3.5 py-2 text-sm font-bold text-amber-800">
          {t('Działasz w imieniu: {name}. Wizyty, dokumenty i rezerwacje dotyczą tego profilu.',
            { name: `${active.first_name} ${active.last_name}` })}
        </p>
      )}
      <div className="pt-3">
        <Outlet />
      </div>
    </div>
  )
}
