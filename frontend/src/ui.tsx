// Komponenty UI — system designu (hybryda Soft Clinical × Bento).
// Białe kafle 20px na gray-50, pigułkowe przyciski, soft chipy statusów.
// ZASADA RESTRAINT: max 1 akcja primary + 1 secondary na kafel.

import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { useI18n } from './lib/i18n'

export const cx = (...parts: Array<string | false | undefined>) =>
  parts.filter(Boolean).join(' ')

/* ---------- Nagłówki ---------- */

export const Overline = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cx('text-xs font-extrabold tracking-wider text-gray-400 uppercase', className)}>{children}</p>
)

export function PageHeader({ overline, title, sub, action }: {
  overline?: string; title: ReactNode; sub?: ReactNode; action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {overline && <p className="text-sm font-semibold text-gray-400">{overline}</p>}
        <h1 className="mt-0.5 text-[28px] leading-tight font-extrabold tracking-tight text-gray-900">{title}</h1>
        {sub && <p className="mt-1 text-sm font-medium text-gray-500">{sub}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}

/* ---------- Button (pigułka) ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'lg' | 'sm'
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cx(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full font-bold transition-all',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        size === 'md' && 'h-10 px-5 text-sm',
        size === 'sm' && 'h-8 px-4 text-xs',
        variant === 'primary' && 'bg-primary text-white hover:bg-primary-hover',
        variant === 'secondary' && 'bg-gray-100 text-gray-700 hover:bg-gray-200',
        variant === 'ghost' && 'text-gray-500 hover:bg-gray-100 hover:text-gray-900',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
      {...props}
    />
  )
}

/* ---------- Tile (kafel) ---------- */

export function Tile({ children, className, delay }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <div
      className={cx('tile-shadow fade-up rounded-[20px] bg-surface', className ?? 'p-5 sm:p-6')}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}

export function TileHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <Overline>{title}</Overline>
      {action}
    </div>
  )
}

/* ---------- Statusy — miękkie chipy ---------- */

export type Tone = 'success' | 'warn' | 'error' | 'neutral' | 'info'

const chipTone: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-700',
  error: 'bg-red-50 text-red-700',
  neutral: 'bg-gray-100 text-gray-500',
  info: 'bg-sky-50 text-sky-700',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap', chipTone[tone])}>
      {children}
    </span>
  )
}

const statusMap: Record<string, { label: string; tone: Tone }> = {
  FREE: { label: 'wolny termin', tone: 'neutral' },
  TEMP_LOCK: { label: 'blokada tymczasowa', tone: 'warn' },
  CONFIRMED: { label: 'potwierdzona', tone: 'success' },
  IN_PROGRESS: { label: 'w trakcie', tone: 'info' },
  PAUSED: { label: 'wstrzymana', tone: 'warn' },
  COMPLETED: { label: 'zakończona', tone: 'neutral' },
  CANCELLED: { label: 'odwołana', tone: 'error' },
  NO_SHOW: { label: 'nieodbyta', tone: 'error' },
  INTERRUPTED: { label: 'przerwana', tone: 'error' },
  DRAFT: { label: 'szkic', tone: 'neutral' },
  SENT_TO_P1: { label: 'wysłana do P1', tone: 'warn' },
  REALIZED: { label: 'zrealizowana', tone: 'neutral' },
  ERROR: { label: 'błąd wysyłki', tone: 'error' },
  ORDERED: { label: 'zlecone', tone: 'neutral' },
  AWAITING_PATIENT: { label: 'oczekuje na pacjenta', tone: 'warn' },
  SAMPLE_TAKEN: { label: 'próbka pobrana', tone: 'info' },
  IN_ANALYSIS: { label: 'w analizie', tone: 'warn' },
  READY: { label: 'wynik gotowy', tone: 'success' },
  RECEIVED_BY_DOCTOR: { label: 'odebrany', tone: 'neutral' },
  REVOKED: { label: 'anulowano', tone: 'error' },
  INVALID_SAMPLE: { label: 'materiał niewłaściwy', tone: 'error' },
  ACTIVE: { label: 'aktywne', tone: 'success' },
  FINAL: { label: 'zatwierdzona', tone: 'neutral' },
  SENT: { label: 'wysłane do ZUS', tone: 'success' },
  PLANNED: { label: 'zaplanowany', tone: 'warn' },
  DONE: { label: 'wykonany', tone: 'success' },
  OK: { label: 'działa', tone: 'success' },
  WARN: { label: 'opóźnienia', tone: 'warn' },
}

export function StatusBadge({ status }: { status: string }) {
  // useI18n poza I18nProviderem (portale personelu) zwraca identyczność — zostaje PL
  const { t } = useI18n()
  const s = statusMap[status] ?? { label: status, tone: 'neutral' as Tone }
  return <Badge tone={s.tone}>{t(s.label)}</Badge>
}

/* ---------- Avatar ---------- */

export function Avatar({ initials, size = 'md' }: { initials: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-extrabold text-primary',
        size === 'sm' && 'h-8 w-8 text-xs',
        size === 'md' && 'h-10 w-10 text-sm',
        size === 'lg' && 'h-14 w-14 text-lg',
      )}
    >
      {initials}
    </span>
  )
}

/* blok daty — kalendarzowa winieta (bento) */
export function DateChip({ month, day, time }: { month: string; day: string; time?: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl bg-primary px-4 py-2.5 text-white">
      <span className="text-[11px] font-bold tracking-wider uppercase opacity-80">{month}</span>
      <span className="text-3xl leading-none font-extrabold">{day}</span>
      {time && <span className="mt-0.5 text-sm font-bold">{time}</span>}
    </div>
  )
}

/* ---------- Tabele ---------- */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm [font-variant-numeric:tabular-nums]">{children}</table>
    </div>
  )
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cx('px-4 py-3 text-left text-xs font-extrabold tracking-wider text-gray-400 uppercase', className)}>
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('border-t border-gray-100 px-4 py-3.5 align-middle', className)}>{children}</td>
}

/* ---------- Drobne ---------- */

export function Stat({ label, value, hint, delay }: { label: string; value: string; hint?: string; delay?: number }) {
  return (
    <Tile className="p-5" delay={delay}>
      <Overline>{label}</Overline>
      <p className="mt-2 text-4xl font-extrabold tracking-tight text-gray-900 [font-variant-numeric:tabular-nums]">{value}</p>
      {hint && <p className="mt-1 text-xs font-semibold text-gray-400">{hint}</p>}
    </Tile>
  )
}

// stan ładowania listy/widoku — odróżnia „wczytuję" od „pusto"
// (zapobiega miganiu EmptyState zanim dane z useQuery dojdą)
export function Loading({ label = 'Wczytywanie…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm font-semibold text-gray-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-primary" />
      {label}
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-gray-50 px-6 py-12 text-center">
      <span className="text-gray-300">{icon}</span>
      <p className="font-extrabold text-gray-700">{title}</p>
      <p className="max-w-sm text-sm font-medium text-gray-500">{hint}</p>
    </div>
  )
}

export function Modal({ title, overline, children, onClose, footer, wide }: {
  title: string; overline?: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  // dostępność dialogu (APG): fokus wchodzi do okna na otwarciu i wraca na
  // wyzwalacz po zamknięciu. Klawiaturę (Esc/Tab) obsługuje onKeyDown NA oknie,
  // nie na document — dzięki temu portalowane popovery (DatePicker/Select w body,
  // poza oknem) nie zamykają okna swoim Escape.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    ;(first ?? ref.current)?.focus()
    return () => prev?.focus?.()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab' || !ref.current) return
    const f = Array.from(ref.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(el => el.offsetParent !== null)
    if (f.length === 0) { e.preventDefault(); return }
    const i = f.indexOf(document.activeElement as HTMLElement)
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus() }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus() }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={onKeyDown}
        className={cx('w-full rounded-[24px] bg-surface shadow-[0_24px_64px_-16px_rgba(16,24,40,0.3)] outline-none',
          wide ? 'max-w-3xl' : 'max-w-lg')}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-4">
          {overline && <Overline className="mb-1">{overline}</Overline>}
          <h3 className="text-lg font-extrabold text-gray-900">{title}</h3>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-6 pb-2">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs font-medium text-gray-400">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'h-11 w-full rounded-xl border border-gray-200 bg-surface px-3.5 text-sm font-medium text-gray-900 placeholder:text-gray-400 hover:border-gray-300'
