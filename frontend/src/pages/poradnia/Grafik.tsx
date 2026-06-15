// Grafik dnia placówki dla rejestracji (UC-PP2) — obłożenie lekarzy: wolne
// vs zajęte terminy, kto/kiedy/u kogo. Klik w zajętą wizytę → kartoteka
// (przełóż/odwołaj), „Umów" przy wolnym → strona rezerwacji.
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarRange, MapPin, Plus, Stethoscope, Video } from 'lucide-react'
import { EmptyState, Loading, PageHeader, StatusBadge, Tile, TileHeader, cx } from '../../ui'
import { api } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { AppointmentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { DatePicker } from '../../components/DatePicker'

const DAY_KEY = 'novamed-poradnia-grafik-day'
const todayIso = () => new Date().toISOString().slice(0, 10)

export function Grafik() {
  const navigate = useNavigate()
  const { clinics, clinic, setClinicId } = useClinicSelection()
  const [day, setDayState] = useState(() => sessionStorage.getItem(DAY_KEY) ?? todayIso())
  const setDay = (d: string) => { sessionStorage.setItem(DAY_KEY, d); setDayState(d) }

  const { data: items } = useQuery({
    queryKey: ['clinic-day', clinic?.clinic_id, day],
    queryFn: () => api<AppointmentOut[]>(`/clinics/${clinic!.clinic_id}/day?day=${day}`),
    enabled: !!clinic,
  })

  // grupowanie po lekarzu (po ID, nie nazwisku — imienniki się nie zlewają);
  // badania (bez lekarza) w osobnej grupie „Pracownia"
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; list: AppointmentOut[] }>()
    for (const a of items ?? []) {
      const key = a.doctor_id ?? '__exam'
      const g = map.get(key) ?? { label: a.doctor_id ? a.doctor_name : 'Pracownia (badania)', list: [] }
      g.list.push(a)
      map.set(key, g)
    }
    return [...map.entries()]
  }, [items])

  const free = (items ?? []).filter(a => a.appointment_status === 'FREE').length
  const taken = (items ?? []).length - free

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Grafik dnia"
          sub={items ? `${formatDatePL(day + 'T00:00:00')} · ${taken} zajętych · ${free} wolnych` : 'Obłożenie lekarzy — wolne i zajęte terminy'}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />
              <DatePicker className="w-44" value={day} onChange={setDay} />
              <Link to="/terminy" className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3.5 py-2 text-xs font-extrabold text-gray-600 hover:bg-primary-soft hover:text-primary">
                <Plus size={14} /> Terminy
              </Link>
            </div>
          }
        />
      </div>

      {items === undefined ? <Loading /> : groups.length === 0 ? (
        <Tile className="p-5">
          <EmptyState
            icon={<CalendarRange size={28} strokeWidth={1.5} />}
            title="Brak terminów tego dnia"
            hint="Wybierz inny dzień albo dodaj terminy w zakładce „Terminy”."
          />
        </Tile>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map(([key, { label, list }], gi) => {
            const gfree = list.filter(a => a.appointment_status === 'FREE').length
            return (
              <Tile key={key} className="p-5" delay={60 + gi * 30}>
                <TileHeader
                  title={<span className="inline-flex items-center gap-1.5"><Stethoscope size={13} /> {label}</span>}
                  action={<span className="text-xs font-bold text-gray-400">{list.length - gfree}/{list.length} zajęte</span>}
                />
                <ul className="space-y-1.5">
                  {list.map(a => {
                    const isFree = a.appointment_status === 'FREE'
                    const live = a.appointment_status === 'IN_PROGRESS'
                    const paused = a.appointment_status === 'PAUSED'
                    const done = ['COMPLETED', 'NO_SHOW', 'INTERRUPTED'].includes(a.appointment_status)
                    return (
                      <li key={a.appointment_id}
                        className={cx(
                          'flex flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5',
                          isFree ? 'border border-dashed border-gray-200'
                            : live ? 'bg-primary-soft ring-1 ring-primary'
                            : paused ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-gray-50',
                          done && 'opacity-60',
                        )}
                      >
                        <span className={cx('w-12 text-sm font-extrabold [font-variant-numeric:tabular-nums]', isFree ? 'text-gray-300' : 'text-gray-500')}>
                          {formatTime(a.appointment_datetime)}
                        </span>
                        <span className="text-gray-300">{a.appointment_type === 'ONLINE' ? <Video size={14} /> : <MapPin size={14} />}</span>
                        {isFree ? (
                          <>
                            <span className="flex-1 text-sm font-medium text-gray-400">
                              wolny termin · {a.price ? `${a.price} zł` : 'NFZ'}
                            </span>
                            <button onClick={() => navigate('/umow', { state: { doctorId: a.doctor_id, day } })}
                              className="cursor-pointer rounded-full px-3 py-1 text-xs font-extrabold text-primary hover:bg-primary-soft">
                              Umów
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => a.patient_id && navigate(`/pacjent/${a.patient_id}`)}
                              className="min-w-0 flex-1 cursor-pointer text-left">
                              <span className="block truncate text-sm font-extrabold text-gray-900 hover:text-primary">
                                {a.patient_name ?? a.service_name}
                              </span>
                              {a.appointment_status === 'CONFIRMED' && a.confirmation_requested && (
                                <span className={cx('text-[11px] font-bold', a.patient_confirmed ? 'text-emerald-600' : 'text-amber-600')}>
                                  {a.patient_confirmed ? 'obecność potwierdzona' : 'bez potwierdzenia'}
                                </span>
                              )}
                            </button>
                            <StatusBadge status={a.appointment_status} />
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </Tile>
            )
          })}
        </div>
      )}
    </div>
  )
}
