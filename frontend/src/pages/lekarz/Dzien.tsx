import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, Clock, DoorOpen, MapPin, Pause, Users, Video, XCircle } from 'lucide-react'
import { Badge, Button, EmptyState, Modal, PageHeader, StatusBadge, Tile, cx } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { AppointmentOut } from '../../lib/types'
import { DatePicker } from '../../components/DatePicker'

const todayIso = () => new Date().toISOString().slice(0, 10)

// wybrana data trzyma się przez sesję — powrót z kartoteki/gabinetu nie resetuje
// jej na dziś (przycisk „Dziś" zawsze wraca na bieżący dzień)
const DAY_KEY = 'novamed-doctor-day'

const FINISHED = ['COMPLETED', 'NO_SHOW', 'CANCELLED']

function StatTile({ icon, label, value, sub, delay }: {
  icon: ReactNode; label: string; value: ReactNode; sub?: string; delay: number
}) {
  return (
    <Tile className="p-4" delay={delay}>
      <p className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-gray-500 uppercase">
        {icon} {label}
      </p>
      <p className="mt-1 text-xl font-extrabold text-gray-900 [font-variant-numeric:tabular-nums]">{value}</p>
      {sub && <p className="truncate text-xs font-semibold text-gray-500">{sub}</p>}
    </Tile>
  )
}

export function LekarzDzien() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [day, setDayState] = useState(() => sessionStorage.getItem(DAY_KEY) ?? todayIso())
  const setDay = (d: string) => { sessionStorage.setItem(DAY_KEY, d); setDayState(d) }
  const [error, setError] = useState<string | null>(null)
  const [noShowFor, setNoShowFor] = useState<AppointmentOut | null>(null)

  const { data: visits } = useQuery({
    queryKey: ['doctor-day', day],
    queryFn: () => api<AppointmentOut[]>(`/appointments/day?day=${day}`),
  })

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api(`/appointments/${id}/status`, { method: 'POST', body: { new_status: status } }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['doctor-day'] }); void queryClient.invalidateQueries({ queryKey: ['doctor-active'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zmienić statusu.'),
  })

  const startVisit = (v: AppointmentOut) => {
    // nawigacja dopiero po sukcesie — przy „masz już wizytę w toku" (409)
    // zostajemy na liście z komunikatem, zamiast wchodzić do nieotwartej wizyty
    changeStatus.mutate({ id: v.appointment_id, status: 'IN_PROGRESS' }, {
      onSuccess: () => navigate(v.appointment_type === 'ONLINE' ? `/telewizyta/${v.appointment_id}` : `/wizyta/${v.appointment_id}`),
    })
  }

  // „teraz" odświeżane co 30 s — przesuwa krechę i statystyki bez przeładowania
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // odwołane wizyty nie liczą się jako „pacjenci dnia" ani do mianownika statystyk
  const booked = (visits ?? []).filter(v => v.patient_id !== null && v.appointment_status !== 'CANCELLED')
  const done = booked.filter(v => v.appointment_status === 'COMPLETED').length
  const isToday = day === todayIso()
  const now = new Date()
  const next = booked.find(v =>
    v.appointment_status === 'CONFIRMED' && (!isToday || new Date(v.appointment_datetime) > now))
  const online = booked.filter(v =>
    v.appointment_type === 'ONLINE' && !FINISHED.includes(v.appointment_status)).length
  // krecha „teraz": przed pierwszym terminem późniejszym niż bieżąca godzina
  const nowIdx = (visits ?? []).findIndex(v => new Date(v.appointment_datetime) > now)

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="Mój dzień"
          title={formatDatePL(day + 'T00:00:00')}
          action={<>
            {day !== todayIso() && (
              <Button size="sm" variant="secondary" onClick={() => setDay(todayIso())}>Dziś</Button>
            )}
            <DatePicker className="w-52" value={day} onChange={setDay} />
          </>}
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      {visits !== undefined && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile delay={30} icon={<Users size={12} />} label="Pacjenci" value={booked.length} />
          <StatTile delay={60} icon={<CheckCircle2 size={12} />} label="Zakończone" value={`${done} / ${booked.length}`} />
          <StatTile
            delay={90} icon={<Clock size={12} />} label="Następny pacjent"
            value={next ? formatTime(next.appointment_datetime) : '—'}
            sub={next?.patient_name ?? undefined}
          />
          <StatTile delay={120} icon={<Video size={12} />} label="Teleporady" value={online} />
        </div>
      )}

      <Tile className="p-3 sm:p-4" delay={150}>
        {visits === undefined ? (
          <p className="py-10 text-center text-sm font-semibold text-gray-500">Wczytywanie grafiku…</p>
        ) : visits.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={28} strokeWidth={1.5} />}
            title="Brak terminów tego dnia"
            hint="Terminy do kalendarza dodaje rejestracja w Panelu Poradni."
          />
        ) : (
          <ul className="space-y-1.5">
            {(visits ?? []).map((v, i) => {
              const live = v.appointment_status === 'IN_PROGRESS'
              const paused = v.appointment_status === 'PAUSED'
              const finished = FINISHED.includes(v.appointment_status)
              const past = new Date(v.appointment_datetime) < now
              const nowLine = isToday && i === nowIdx && (
                <li aria-label="Bieżąca godzina" className="flex items-center gap-2 px-1">
                  <span className="text-[11px] font-extrabold text-red-500 [font-variant-numeric:tabular-nums]">
                    {`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`}
                  </span>
                  <span className="h-0.5 flex-1 rounded-full bg-red-400/70" />
                </li>
              )
              if (!v.patient_id) {
                return (
                  <Fragment key={v.appointment_id}>
                    {nowLine}
                    <li className={cx(
                      'flex items-center gap-4 rounded-2xl border border-dashed border-gray-200 px-4 py-3',
                      past && 'opacity-50',
                    )}>
                      <span className="w-12 text-sm font-bold text-gray-500 [font-variant-numeric:tabular-nums]">{formatTime(v.appointment_datetime)}</span>
                      <span className="text-sm font-medium text-gray-500">wolny termin</span>
                    </li>
                  </Fragment>
                )
              }
              return (
                <Fragment key={v.appointment_id}>
                {nowLine}
                <li
                  className={cx(
                    'flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3',
                    live ? 'bg-primary-soft ring-2 ring-primary'
                      : paused ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-gray-50',
                    finished && 'opacity-60 transition-opacity hover:opacity-100',
                  )}
                >
                  <span className={cx('flex w-16 items-center gap-1 text-sm font-extrabold [font-variant-numeric:tabular-nums]', live ? 'text-primary' : paused ? 'text-amber-600' : 'text-gray-500')}>
                    {paused && <Pause size={13} className="shrink-0" />}
                    {v.appointment_status === 'COMPLETED' && <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />}
                    {(v.appointment_status === 'NO_SHOW' || v.appointment_status === 'CANCELLED') && <XCircle size={14} className="shrink-0 text-gray-300" />}
                    {formatTime(v.appointment_datetime)}
                  </span>
                  <span className="text-gray-500">{v.appointment_type === 'ONLINE' ? <Video size={15} /> : <MapPin size={15} />}</span>
                  <button
                    onClick={() => navigate(`/wizyta/${v.appointment_id}`)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    title="Otwórz wizytę (gabinet)"
                  >
                    <p className="text-sm font-extrabold text-gray-900 hover:text-primary">{v.patient_name}</p>
                    {v.notes && <p className="truncate text-xs font-medium text-gray-500">{v.notes}</p>}
                  </button>
                  {v.price != null && <Badge tone="neutral">{v.price} zł</Badge>}
                  {isToday && past && v.appointment_status === 'CONFIRMED' && (
                    <Badge tone="warn">spóźnienie {Math.max(1, Math.round((now.getTime() - new Date(v.appointment_datetime).getTime()) / 60000))} min</Badge>
                  )}
                  {v.appointment_status === 'CONFIRMED' && v.confirmation_requested && (
                    v.patient_confirmed
                      ? <Badge tone="success">obecność potwierdzona</Badge>
                      : <Badge tone="warn">bez potwierdzenia</Badge>
                  )}
                  <StatusBadge status={v.appointment_status} />
                  <div className="flex gap-2">
                    {isToday && v.appointment_status === 'CONFIRMED' && (
                      <>
                        <Button size="sm" disabled={changeStatus.isPending} onClick={() => startVisit(v)}>
                          {v.appointment_type === 'ONLINE' ? <><Video size={14} /> Połącz</> : <><DoorOpen size={14} /> Rozpocznij</>}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setNoShowFor(v)}>
                          Nie stawił się
                        </Button>
                      </>
                    )}
                    {v.appointment_status === 'NO_SHOW' && isToday && (
                      <Button size="sm" variant="ghost" disabled={changeStatus.isPending} title="Pacjent dotarł spóźniony — podejmij wizytę" onClick={() => startVisit(v)}>
                        Jednak przyszedł
                      </Button>
                    )}
                    {paused && (
                      <Button size="sm" disabled={changeStatus.isPending} onClick={() => startVisit(v)}>
                        <DoorOpen size={14} /> Wznów
                      </Button>
                    )}
                    {live && (
                      <>
                        <Button size="sm" onClick={() => navigate(`/wizyta/${v.appointment_id}`)}>
                          <DoorOpen size={14} /> Gabinet
                        </Button>
                        {v.appointment_type === 'ONLINE' && (
                          <Button size="sm" variant="secondary" onClick={() => navigate(`/telewizyta/${v.appointment_id}`)}>
                            <Video size={14} /> Rozmowa
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </li>
                </Fragment>
              )
            })}
            {isToday && nowIdx === -1 && (visits ?? []).length > 0 && (
              <li aria-label="Bieżąca godzina" className="flex items-center gap-2 px-1">
                <span className="text-[11px] font-extrabold text-red-500 [font-variant-numeric:tabular-nums]">
                  {`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`}
                </span>
                <span className="h-0.5 flex-1 rounded-full bg-red-400/70" />
              </li>
            )}
          </ul>
        )}
      </Tile>

      {noShowFor && (
        <Modal
          overline={`${formatTime(noShowFor.appointment_datetime)} · ${noShowFor.patient_name}`}
          title="Pacjent się nie stawił?"
          onClose={() => setNoShowFor(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setNoShowFor(null)}>Wróć</Button>
            <Button variant="danger" onClick={() => { changeStatus.mutate({ id: noShowFor.appointment_id, status: 'NO_SHOW' }); setNoShowFor(null) }}>
              Tak, oznacz NO-SHOW
            </Button>
          </>}
        >
          <p className="text-sm leading-relaxed font-medium text-gray-600">
            Wizyta zostanie oznaczona jako „nie stawił się". Tej zmiany nie można cofnąć.
          </p>
        </Modal>
      )}
    </div>
  )
}
