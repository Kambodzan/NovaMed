import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '../ui'
import { useI18n } from '../lib/i18n'
import { formatTime } from '../lib/format'
import type { AppointmentOut } from '../lib/types'

// Inline miesięczny kalendarzyk wyboru terminu — zamiast płaskiej listy slotów.
// Dni z wolnymi terminami są klikalne; po wyborze dnia pokazują się pigułki
// godzin. Spójny ze wspólnym systemem designu (teal, pigułki, miękkie kafle). Używany przy
// przekładaniu wizyty (pacjent/recepcja/gość) — sloty tego samego lekarza/badania.

const pad = (n: number) => String(n).padStart(2, '0')
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const WEEKDAYS = {
  pl: ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
}

export function SlotCalendar({ slots, onPick, busy = false, showMeta = false }: {
  slots: AppointmentOut[]
  onPick: (slot: AppointmentOut) => void
  busy?: boolean
  showMeta?: boolean   // pokaż placówkę/cenę pod godziną (ten sam lekarz bywa w kilku placówkach)
}) {
  const { lang, t } = useI18n()
  const locale = lang === 'en' ? 'en-GB' : 'pl-PL'

  // grupowanie po dniu (lokalny czas), posortowane rosnąco po godzinie
  const byDay = useMemo(() => {
    const m = new Map<string, AppointmentOut[]>()
    for (const s of [...slots].sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))) {
      const key = isoDay(new Date(s.appointment_datetime))
      ;(m.get(key) ?? m.set(key, []).get(key)!).push(s)
    }
    return m
  }, [slots])

  const days = useMemo(() => [...byDay.keys()].sort(), [byDay])
  const first = days[0]
  const last = days[days.length - 1]

  const [cursor, setCursor] = useState(() => {
    const base = first ? new Date(first + 'T00:00:00') : new Date()
    return { y: base.getFullYear(), m: base.getMonth() }
  })
  const [selected, setSelected] = useState<string | null>(first ?? null)

  // terminy dochodzą asynchronicznie (query) — gdy pojawi się pierwszy dzień,
  // ustaw go domyślnie i przewiń kalendarz na jego miesiąc
  useEffect(() => {
    if (selected === null && first) {
      setSelected(first)
      const d = new Date(first + 'T00:00:00')
      setCursor({ y: d.getFullYear(), m: d.getMonth() })
    }
  }, [first, selected])

  if (days.length === 0) {
    return <p className="py-4 text-sm font-medium text-gray-500">{t('Ten lekarz nie ma teraz wolnych terminów.')}</p>
  }

  const { y: cy, m: cm } = cursor
  const monthLabel = new Date(cy, cm, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const daysInMonth = new Date(cy, cm + 1, 0).getDate()
  const firstWeekday = (new Date(cy, cm, 1).getDay() + 6) % 7 // poniedziałek = 0

  // nawigacja tylko w obrębie miesięcy, które mają wolne terminy
  const ym = (iso: string) => iso.slice(0, 7)
  const curYm = `${cy}-${pad(cm + 1)}`
  const canPrev = first !== undefined && curYm > ym(first)
  const canNext = last !== undefined && curYm < ym(last)
  const step = (dir: -1 | 1) => setCursor(({ y, m }) => {
    const nm = m + dir
    return nm < 0 ? { y: y - 1, m: 11 } : nm > 11 ? { y: y + 1, m: 0 } : { y, m: nm }
  })

  const navBtn = 'flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-default disabled:text-gray-200 disabled:hover:bg-transparent'
  const cellBase = 'flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors'

  const todayIso = isoDay(new Date())
  const dayTimes = selected ? (byDay.get(selected) ?? []) : []

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label={t('Poprzedni')} className={navBtn} disabled={!canPrev} onClick={() => canPrev && step(-1)}>
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-extrabold text-gray-900 capitalize">{monthLabel}</span>
        <button type="button" aria-label={t('Następny')} className={navBtn} disabled={!canNext} onClick={() => canNext && step(1)}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 text-center">
        {WEEKDAYS[lang === 'en' ? 'en' : 'pl'].map(d => (
          <span key={d} className="text-[11px] font-extrabold tracking-wider text-gray-500 uppercase">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 place-items-center gap-y-0.5">
        {Array.from({ length: firstWeekday }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const iso = `${cy}-${pad(cm + 1)}-${pad(i + 1)}`
          const has = byDay.has(iso)
          const isSel = iso === selected
          return (
            <button
              key={iso} type="button" disabled={!has}
              aria-pressed={isSel}
              onClick={() => setSelected(iso)}
              className={cx(
                cellBase,
                isSel ? 'bg-primary text-white'
                  : !has ? 'cursor-default text-gray-200'
                  : iso === todayIso ? 'font-extrabold text-primary ring-1 ring-primary/40 hover:bg-primary-soft'
                  : 'font-bold text-gray-800 ring-1 ring-primary/30 hover:bg-primary-soft',
              )}
            >
              {i + 1}
            </button>
          )
        })}
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        {selected ? (
          <>
            <p className="mb-2 text-xs font-extrabold tracking-wider text-gray-500 uppercase">
              {new Date(selected + 'T00:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <div className="flex flex-wrap gap-2">
              {dayTimes.map(s => (
                <button
                  key={s.appointment_id} type="button" disabled={busy}
                  onClick={() => onPick(s)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-center transition-colors hover:border-primary hover:bg-primary-soft disabled:cursor-default disabled:opacity-50"
                >
                  <span className="block text-sm font-extrabold text-gray-900">{formatTime(s.appointment_datetime)}</span>
                  {showMeta && (
                    <span className="mt-0.5 block text-[11px] font-semibold text-gray-500">
                      {s.appointment_type === 'ONLINE' ? t('teleporada') : s.clinic_name}
                      {s.price ? ` · ${s.price} zł` : ''}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm font-medium text-gray-500">{t('Wybierz dzień z kalendarza.')}</p>
        )}
      </div>
    </div>
  )
}
