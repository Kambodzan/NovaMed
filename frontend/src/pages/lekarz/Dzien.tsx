import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, MapPin, Video } from 'lucide-react'
import { Button, EmptyState, PageHeader, StatusBadge, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { AppointmentOut } from '../../lib/types'
import { KartaPacjenta } from './KartaPacjenta'

const todayIso = () => new Date().toISOString().slice(0, 10)

export function LekarzDzien() {
  const queryClient = useQueryClient()
  const [day, setDay] = useState(todayIso())
  const [karta, setKarta] = useState<AppointmentOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: visits } = useQuery({
    queryKey: ['doctor-day', day],
    queryFn: () => api<AppointmentOut[]>(`/appointments/day?day=${day}`),
  })

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      api(`/appointments/${id}/status`, { method: 'POST', body: { new_status: status } }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['doctor-day'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zmienić statusu.'),
  })

  const booked = (visits ?? []).filter(v => v.patient_id !== null)
  const done = booked.filter(v => v.appointment_status === 'COMPLETED').length

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="Mój dzień"
          title={formatDatePL(day + 'T00:00:00')}
          sub={`${booked.length} pacjentów · ${done} zakończone`}
          action={<input type="date" className={cx(inputCls, 'w-44')} value={day} onChange={e => setDay(e.target.value)} />}
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <Tile className="p-3 sm:p-4" delay={60}>
        {(visits ?? []).length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={28} strokeWidth={1.5} />}
            title="Brak terminów tego dnia"
            hint="Terminy do kalendarza dodaje rejestracja w Panelu Poradni."
          />
        ) : (
          <ul className="space-y-1.5">
            {(visits ?? []).map(v => {
              const now = v.appointment_status === 'IN_PROGRESS'
              if (!v.patient_id) {
                return (
                  <li key={v.appointment_id} className="flex items-center gap-4 rounded-2xl border border-dashed border-gray-200 px-4 py-3">
                    <span className="w-12 text-sm font-bold text-gray-300 [font-variant-numeric:tabular-nums]">{formatTime(v.appointment_datetime)}</span>
                    <span className="text-sm font-medium text-gray-400">wolny termin</span>
                  </li>
                )
              }
              return (
                <li
                  key={v.appointment_id}
                  className={cx(
                    'flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3',
                    now ? 'bg-primary-soft ring-2 ring-primary' : 'bg-gray-50',
                  )}
                >
                  <span className={cx('w-12 text-sm font-extrabold [font-variant-numeric:tabular-nums]', now ? 'text-primary' : 'text-gray-400')}>
                    {formatTime(v.appointment_datetime)}
                  </span>
                  <span className="text-gray-400">{v.appointment_type === 'ONLINE' ? <Video size={15} /> : <MapPin size={15} />}</span>
                  <button onClick={() => setKarta(v)} className="min-w-0 flex-1 cursor-pointer text-left">
                    <p className="text-sm font-extrabold text-gray-900 hover:text-primary">{v.patient_name}</p>
                  </button>
                  <StatusBadge status={v.appointment_status} />
                  <div className="flex gap-2">
                    {v.appointment_status === 'CONFIRMED' && (
                      <>
                        <Button size="sm" onClick={() => changeStatus.mutate({ id: v.appointment_id, status: 'IN_PROGRESS' })}>Rozpocznij</Button>
                        <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate({ id: v.appointment_id, status: 'NO_SHOW' })}>Nie stawił się</Button>
                      </>
                    )}
                    {now && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setKarta(v)}>Karta pacjenta</Button>
                        <Button size="sm" onClick={() => changeStatus.mutate({ id: v.appointment_id, status: 'COMPLETED' })}>Zakończ</Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Tile>

      {karta && karta.patient_id && (
        <KartaPacjenta
          patientId={karta.patient_id}
          appointmentId={karta.appointment_id}
          onClose={() => setKarta(null)}
        />
      )}
    </div>
  )
}
