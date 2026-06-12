import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Check, ChevronDown, HeartPulse, LogOut, MessageSquare, Users } from 'lucide-react'
import { Avatar, cx } from '../ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { NotificationsBell } from '../components/NotificationsBell'

const navItems = [
  { to: '/', label: 'Start' },
  { to: '/umow', label: 'Umów wizytę' },
  { to: '/wizyty', label: 'Moje wizyty' },
  { to: '/recepty', label: 'Recepty' },
  { to: '/skierowania', label: 'Skierowania' },
  { to: '/dokumentacja', label: 'Dokumentacja' },
  { to: '/udostepnij', label: 'Udostępnij' },
  { to: '/rodzina', label: 'Rodzina' },
]

function AccountMenu() {
  const { me, logout, refreshMe } = useAuth()
  const { dependents, activeId, setActiveId, active } = useFamily()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const toggleSms = async () => {
    await api('/auth/me/preferences', { method: 'PATCH', body: { notify_sms: !me?.notify_sms } })
    await refreshMe()
  }

  const myName = me?.first_name ? `${me.first_name} ${me.last_name}` : (me?.email ?? '')
  const shownName = active ? `${active.first_name} ${active.last_name}` : myName
  const initials = shownName.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase() || '?'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          'tile-shadow flex cursor-pointer items-center gap-2 rounded-full bg-surface py-1.5 pr-2.5 pl-1.5',
          !!active && 'ring-2 ring-amber-400',
        )}
      >
        <Avatar initials={initials} size="sm" />
        <span className="hidden max-w-36 truncate text-sm font-bold text-gray-700 sm:inline">{shownName}</span>
        <ChevronDown size={14} className={cx('text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <button aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="tile-shadow absolute right-0 z-20 mt-2 w-64 rounded-2xl bg-surface p-1.5">
            <p className="px-3 pt-2 pb-1 text-xs font-extrabold tracking-wider text-gray-400 uppercase">
              {t('Aktywny profil')}
            </p>
            {[{ id: null as string | null, label: myName }, ...dependents.map(d => ({ id: d.patient_id as string | null, label: `${d.first_name} ${d.last_name}` }))].map(p => (
              <button
                key={p.id ?? 'me'}
                role="menuitem"
                onClick={() => { setActiveId(p.id); setOpen(false) }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <span className="w-4">{(activeId ?? null) === p.id && <Check size={14} className="text-primary" />}</span>
                {p.label}
              </button>
            ))}
            <button
              role="menuitem"
              onClick={() => { setOpen(false); navigate('/rodzina') }}
              className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-xl border-t border-gray-100 px-3 py-2 pt-2.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <Users size={14} className="text-gray-400" /> {t('Rodzina')}
            </button>
            <button
              role="menuitem"
              onClick={() => void toggleSms()}
              className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <MessageSquare size={14} className="text-gray-400" />
              <span className="flex-1">{t('Powiadomienia SMS')}</span>
              <span className={cx(
                'rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase',
                me?.notify_sms ? 'bg-primary-soft text-primary' : 'bg-gray-100 text-gray-400',
              )}>
                {me?.notify_sms ? t('wł.') : t('wył.')}
              </span>
            </button>
            <button
              role="menuitem"
              onClick={() => void logout()}
              className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <LogOut size={14} /> {t('Wyloguj')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function PortalLayout() {
  const { lang, setLang, t } = useI18n()
  const { active } = useFamily()

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
      <header className="space-y-3 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white">
              <HeartPulse size={21} />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-gray-900">NovaMed</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLang(lang === 'pl' ? 'en' : 'pl')}
              aria-label={lang === 'pl' ? 'Switch to English' : 'Przełącz na polski'}
              className="tile-shadow cursor-pointer rounded-full bg-surface px-3 py-2.5 text-xs font-extrabold tracking-wider text-gray-500 uppercase hover:text-gray-900"
            >
              {lang === 'pl' ? 'EN' : 'PL'}
            </button>
            <NotificationsBell />
            <AccountMenu />
          </div>
        </div>

        <nav className="flex justify-center" aria-label={t('Nawigacja')}>
          <div className="tile-shadow flex flex-wrap items-center justify-center gap-1 rounded-full bg-surface p-1.5">
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
          </div>
        </nav>
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
