import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cx, inputCls } from '../ui'
import { useI18n } from '../lib/i18n'

// Własny kalendarz zamiast natywnego <input type="date"> — spójny ze wspólnym systemem designu
// (białe kafle, pigułki, teal). Popover idzie przez portal, więc działa też
// w modalach z overflow-y-auto. Wartość: ISO 'yyyy-mm-dd' (jak w API).

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const todayIso = () => {
  const n = new Date()
  return toIso(n.getFullYear(), n.getMonth(), n.getDate())
}

const WEEKDAYS = {
  pl: ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
}

const POP_W = 292
const POP_H = 352

export function DatePicker({ value, onChange, min, max, required, placeholder, className }: {
  value: string
  onChange: (iso: string) => void
  min?: string
  max?: string
  required?: boolean
  placeholder?: string
  className?: string
}) {
  const { lang, t } = useI18n()
  const locale = lang === 'en' ? 'en-GB' : 'pl-PL'
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [view, setView] = useState<'days' | 'months' | 'years'>('days')

  const selected = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
  const base = selected ? new Date(value + 'T00:00:00') : new Date()
  const [cy, setCy] = useState(base.getFullYear())
  const [cm, setCm] = useState(base.getMonth())

  const show = () => {
    const r = btnRef.current!.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8))
    const top = r.bottom + POP_H + 8 > window.innerHeight && r.top - POP_H - 6 > 0
      ? r.top - POP_H - 6
      : r.bottom + 6
    if (selected) {
      const d = new Date(value + 'T00:00:00')
      setCy(d.getFullYear()); setCm(d.getMonth())
    }
    setPos({ top, left }); setView('days'); setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max)
  const pick = (iso: string) => { onChange(iso); setOpen(false) }

  const monthLabel = new Date(cy, cm, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const display = selected
    ? new Date(value + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    : (placeholder ?? t('Wybierz datę'))

  const daysInMonth = new Date(cy, cm + 1, 0).getDate()
  const firstWeekday = (new Date(cy, cm, 1).getDay() + 6) % 7 // poniedziałek = 0
  const today = todayIso()

  const navBtn = 'flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900'
  const cellBase = 'flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-sm font-semibold transition-colors'

  const prev = () => view === 'days' ? (cm === 0 ? (setCm(11), setCy(cy - 1)) : setCm(cm - 1)) : setCy(cy - (view === 'years' ? 12 : 1))
  const next = () => view === 'days' ? (cm === 11 ? (setCm(0), setCy(cy + 1)) : setCm(cm + 1)) : setCy(cy + (view === 'years' ? 12 : 1))

  const yearsStart = cy - ((cy - 1) % 12) - (view === 'years' ? 0 : 0)

  return (
    <div className={cx('relative', className)}>
      <button
        type="button" ref={btnRef}
        aria-haspopup="dialog" aria-expanded={open}
        onClick={() => open ? setOpen(false) : show()}
        onKeyDown={e => { if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) } }}
        className={cx(inputCls, 'flex cursor-pointer items-center justify-between gap-2 text-left', !selected && 'text-gray-500')}
      >
        <span className="truncate">{display}</span>
        <CalendarDays size={15} className="shrink-0 text-gray-500" />
      </button>
      {/* natywna walidacja required bez natywnego pickera */}
      {required && (
        <input
          tabIndex={-1} aria-hidden required value={value} onChange={() => {}}
          onFocus={() => btnRef.current?.focus()}
          className="absolute inset-x-0 bottom-0 h-px w-full opacity-0"
        />
      )}
      {open && createPortal(
        <div
          ref={popRef} role="dialog" aria-label={t('Wybierz datę')}
          className="fixed z-[80] rounded-2xl border border-gray-100 bg-white p-3 shadow-xl shadow-gray-900/10"
          style={{ top: pos.top, left: pos.left, width: POP_W }}
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label={t('Poprzedni')} className={navBtn} onClick={prev}><ChevronLeft size={16} /></button>
            <button
              type="button"
              className="cursor-pointer rounded-full px-3 py-1.5 text-sm font-extrabold text-gray-900 capitalize hover:bg-gray-100"
              onClick={() => setView(view === 'days' ? 'months' : 'years')}
            >
              {view === 'days' ? monthLabel : view === 'months' ? cy : `${yearsStart}–${yearsStart + 11}`}
            </button>
            <button type="button" aria-label={t('Następny')} className={navBtn} onClick={next}><ChevronRight size={16} /></button>
          </div>

          {view === 'days' && (
            <>
              <div className="mb-1 grid grid-cols-7 text-center">
                {WEEKDAYS[lang === 'en' ? 'en' : 'pl'].map(d => (
                  <span key={d} className="text-[11px] font-extrabold tracking-wider text-gray-500 uppercase">{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 place-items-center gap-y-0.5">
                {Array.from({ length: firstWeekday }, (_, i) => <span key={`b${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const iso = toIso(cy, cm, i + 1)
                  const ok = inRange(iso)
                  return (
                    <button
                      key={iso} type="button" disabled={!ok}
                      aria-pressed={iso === selected}
                      onClick={() => pick(iso)}
                      className={cx(
                        cellBase,
                        iso === selected ? 'bg-primary text-white'
                          : !ok ? 'cursor-default text-gray-200'
                          : iso === today ? 'text-primary ring-1 ring-primary/40 hover:bg-primary-soft'
                          : 'text-gray-700 hover:bg-gray-100',
                      )}
                    >
                      {i + 1}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 flex justify-end border-t border-gray-100 pt-2">
                <button
                  type="button" disabled={!inRange(today)}
                  onClick={() => pick(today)}
                  className="cursor-pointer rounded-full px-3 py-1.5 text-xs font-extrabold text-primary hover:bg-primary-soft disabled:cursor-default disabled:text-gray-300"
                >
                  {t('Dziś')}
                </button>
              </div>
            </>
          )}

          {view === 'months' && (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, m) => (
                <button
                  key={m} type="button"
                  onClick={() => { setCm(m); setView('days') }}
                  className={cx(
                    'cursor-pointer rounded-xl px-2 py-2.5 text-sm font-bold capitalize',
                    m === cm ? 'bg-primary-soft text-primary' : 'text-gray-700 hover:bg-gray-100',
                  )}
                >
                  {new Date(2024, m, 1).toLocaleDateString(locale, { month: 'short' }).replace('.', '')}
                </button>
              ))}
            </div>
          )}

          {view === 'years' && (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, i) => {
                const y = yearsStart + i
                return (
                  <button
                    key={y} type="button"
                    onClick={() => { setCy(y); setView('months') }}
                    className={cx(
                      'cursor-pointer rounded-xl px-2 py-2.5 text-sm font-bold',
                      y === cy ? 'bg-primary-soft text-primary' : 'text-gray-700 hover:bg-gray-100',
                    )}
                  >
                    {y}
                  </button>
                )
              })}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
