import { NavLink, Outlet } from 'react-router-dom'
import { HeartPulse, LogOut } from 'lucide-react'
import { cx } from '../ui'
import { useAuth } from '../lib/auth'

const navItems = [
  { to: '/', label: 'Start' },
  { to: '/umow', label: 'Umów wizytę' },
  { to: '/wizyty', label: 'Moje wizyty' },
  { to: '/dokumentacja', label: 'Dokumentacja' },
]

export function PortalLayout() {
  const { me, logout } = useAuth()

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white">
            <HeartPulse size={21} />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-gray-900">NovaMed</span>
        </div>
        <nav className="tile-shadow flex flex-wrap items-center gap-1 rounded-full bg-surface p-1.5" aria-label="Nawigacja">
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
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm font-bold text-gray-700 sm:inline">
            {me?.first_name ? `${me.first_name} ${me.last_name}` : me?.email}
          </span>
          <button
            onClick={() => void logout()}
            aria-label="Wyloguj"
            className="tile-shadow cursor-pointer rounded-full bg-surface p-2.5 text-gray-500 hover:text-gray-900"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="pt-3">
        <Outlet />
      </div>
    </div>
  )
}
