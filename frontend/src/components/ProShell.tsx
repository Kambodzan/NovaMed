// Szkielet portalu „pro" (personel) — biały sidebar, treść na gray-50.
// Wg system designu.
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { HeartPulse, LogOut, type LucideIcon } from 'lucide-react'
import { cx } from '../ui'
import { useAuth } from '../lib/auth'

export function ProShell({ brand, nav, children }: {
  brand: string
  nav: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }>
  children: ReactNode
}) {
  const { me, logout } = useAuth()

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 shrink-0 flex-col border-r border-gray-100 bg-surface">
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white">
            <HeartPulse size={18} />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="font-extrabold text-gray-900">NovaMed</p>
            <p className="truncate text-[11px] font-bold text-gray-400">{brand}</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Nawigacja główna">
          {nav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cx(
                'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-primary-soft font-extrabold text-primary'
                  : 'font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              <item.icon size={17} strokeWidth={2.2} /> {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gray-900">{me?.username}</p>
            <p className="truncate text-[11px] font-semibold text-gray-400">{me?.email}</p>
          </div>
          <button
            onClick={() => void logout()}
            aria-label="Wyloguj"
            className="shrink-0 cursor-pointer rounded-full p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-900"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 sm:p-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  )
}
