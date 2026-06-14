// Kalendarz tygodniowy lekarza — siatka pon–nd z wizytami i wolnymi terminami.
// Klik w wizytę otwiera gabinet; dzisiejsza kolumna wyróżniona.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CheckCircle2, Video, XCircle } from 'lucide-react'
import { Button, PageHeader, Tile, cx } from '../../ui'
import { api } from '../../lib/api'
import { formatTime } from '../../lib/format'
import type { AppointmentOut } from '../../lib/types'

const pad = (n: number) => String(n).padStart(2, '0')
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DAY_LABEL = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd']

// wybrany tydzień (offset względem bieżącego) trzyma się przez sesję
const OFFSET_KEY = 'novamed-doctor-week-offset'

export function LekarzKalendarz() {
  const navigate = useNavigate()
  const [offset, setOffset] = useState(() => Number(sessionStorage.getItem(OFFSET_KEY)) || 0)
  useEffect(() => { sessionStorage.setItem(OFFSET_KEY, String(offset)) }, [offset])

  const days = useMemo(() => {
    const now = new Date()
    const monday = new Date(now)
    monday.setHours(0, 0, 0, 0)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d
    })
  }, [offset])

  const queries = useQueries({
    queries: days.map(d => ({
      queryKey: ['doctor-day', isoDay(d)],
      queryFn: () => api<AppointmentOut[]>(`/appointments/day?day=${isoDay(d)}`),
    })),
  })

  const today = isoDay(new Date())
  const range = `${days[0].getDate()}.${pad(days[0].getMonth() + 1)} – ${days[6].getDate()}.${pad(days[6].getMonth() + 1)}.${days[6].getFullYear()}`
  const weekTotal = queries.reduce((n, q) => n + (q.data?.filter(v => v.patient_id !== null).length ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="Kalendarz"
          title={`Tydzień ${range}`}
          sub={`${weekTotal} pacjentów w tym tygodniu`}
          action={<>
            <Button size="sm" variant="secondary" aria-label="Poprzedni tydzień" onClick={() => setOffset(o => o - 1)}><ChevronLeft size={15} /></Button>
            {offset !== 0 && <Button size="sm" variant="secondary" onClick={() => setOffset(0)}>Bieżący</Button>}
            <Button size="sm" variant="secondary" aria-label="Następny tydzień" onClick={() => setOffset(o => o + 1)}><ChevronRight size={15} /></Button>
          </>}
        />
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[920px] grid-cols-7 gap-2">
          {days.map((d, i) => {
            const iso = isoDay(d)
            const isToday = iso === today
            const list = queries[i].data ?? []
            const booked = list.filter(v => v.patient_id !== null).length
            return (
              <Tile key={iso} className={cx('p-2.5', isToday && 'ring-2 ring-primary')} delay={30 + i * 20}>
                <p className={cx('mb-2 px-1 text-xs font-extrabold', isToday ? 'text-primary' : 'text-gray-500')}>
                  {DAY_LABEL[i]} {d.getDate()}.{pad(d.getMonth() + 1)}
                  <span className="float-right font-bold text-gray-300">{booked > 0 && booked}</span>
                </p>
                <div className="space-y-1">
                  {list.length === 0 && <p className="px-1 py-2 text-center text-[11px] font-semibold text-gray-300">brak terminów</p>}
                  {list.map(v => {
                    const finished = ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(v.appointment_status)
                    if (!v.patient_id) {
                      return (
                        <div key={v.appointment_id} className="rounded-lg border border-dashed border-gray-200 px-2 py-1.5 text-[11px] font-semibold text-gray-300 [font-variant-numeric:tabular-nums]">
                          {formatTime(v.appointment_datetime)} wolny
                        </div>
                      )
                    }
                    return (
                      <button
                        key={v.appointment_id}
                        onClick={() => navigate(`/wizyta/${v.appointment_id}`)}
                        title={`${v.patient_name} — otwórz gabinet`}
                        className={cx(
                          'flex w-full cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[11px] font-bold transition-colors',
                          v.appointment_status === 'IN_PROGRESS' ? 'bg-primary text-white'
                            : v.appointment_status === 'CONFIRMED' ? 'bg-primary-soft text-primary hover:bg-primary/15'
                            : 'bg-gray-50 text-gray-400 hover:bg-gray-100',
                        )}
                      >
                        <span className="[font-variant-numeric:tabular-nums]">{formatTime(v.appointment_datetime)}</span>
                        {v.appointment_type === 'ONLINE' && <Video size={11} className="shrink-0" />}
                        {v.appointment_status === 'COMPLETED' && <CheckCircle2 size={11} className="shrink-0 text-emerald-500" />}
                        {(v.appointment_status === 'NO_SHOW' || v.appointment_status === 'CANCELLED') && <XCircle size={11} className="shrink-0" />}
                        <span className={cx('min-w-0 truncate', finished && 'font-semibold')}>{v.patient_name}</span>
                      </button>
                    )
                  })}
                </div>
              </Tile>
            )
          })}
        </div>
      </div>
      <p className="text-xs font-medium text-gray-400">
        Kliknij wizytę, aby otworzyć gabinet. Terminy do kalendarza dodaje rejestracja w Panelu Poradni.
      </p>
    </div>
  )
}
