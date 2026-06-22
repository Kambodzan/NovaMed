// Pulpit rejestracji — przegląd dnia placówki + szybkie akcje. Liczy się z
// grafiku dnia (/clinics/{id}/day), żeby od wejścia widać było obłożenie.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, BellRing, CalendarCheck, CalendarDays, CheckCircle2, ChevronRight, Clock, DoorOpen, FlaskConical, UserCheck, Users, Video, X } from 'lucide-react'
import { Button, Loading, Modal, Overline, PageHeader, Tile, TileHeader, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { pushToast } from '../../lib/toast'
import { formatTime } from '../../lib/format'
import type { AppointmentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'

const todayIso = () => new Date().toISOString().slice(0, 10)
const FINISHED = ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'INTERRUPTED']

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'amber' | 'primary' }) {
  return (
    <Tile className="p-5">
      <Overline className={tone === 'amber' ? '!text-amber-600' : undefined}>{label}</Overline>
      <p className={cx('mt-2 text-4xl font-extrabold tracking-tight [font-variant-numeric:tabular-nums]',
        tone === 'amber' ? 'text-amber-700' : tone === 'primary' ? 'text-primary' : 'text-gray-900')}>{value}</p>
      {hint && <p className="mt-1 text-xs font-semibold text-gray-500">{hint}</p>}
    </Tile>
  )
}

const ACTIONS = [
  { to: '/umow', label: 'Umów wizytę', icon: CalendarCheck, desc: 'rezerwacja dla pacjenta' },
  { to: '/wyniki', label: 'Dodaj wynik', icon: FlaskConical, desc: 'odbiór wyniku z papieru' },
  { to: '/pacjenci', label: 'Pacjenci', icon: Users, desc: 'szukaj / kartoteka / eWUŚ' },
  { to: '/kalendarz', label: 'Kalendarz', icon: CalendarDays, desc: 'terminy lekarzy' },
]

export function Pulpit() {
  const queryClient = useQueryClient()
  const { clinics, clinic, setClinicId } = useClinicSelection()
  const navigate = useNavigate()
  const today = todayIso()
  const [arriveFor, setArriveFor] = useState<AppointmentOut | null>(null)
  const [room, setRoom] = useState('')

  // meldowanie pacjenta (recepcja → lekarz): „przyszedł" + gabinet, oraz cofnięcie
  const arrive = useMutation({
    mutationFn: ({ id, room, checked_in }: { id: string; room?: string; checked_in?: boolean }) =>
      api(`/appointments/${id}/arrival`, { method: 'POST', body: { room: room || null, checked_in: checked_in ?? true } }),
    onSuccess: () => { setArriveFor(null); setRoom(''); void queryClient.invalidateQueries({ queryKey: ['clinic-day'] }) },
    onError: (e) => pushToast(e instanceof ApiError ? e.message : 'Nie udało się zameldować pacjenta.', 'error'),
  })

  const remind = useMutation({
    mutationFn: () => api<{ sent: number }>(`/clinics/${clinic!.clinic_id}/remind-unconfirmed?day=${today}`, { method: 'POST' }),
    onSuccess: (r) => {
      pushToast(r.sent ? `Wysłano przypomnienie do ${r.sent} pacjentów.` : 'Brak wizyt do przypomnienia.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['clinic-day'] })
    },
    onError: (e) => pushToast(e instanceof ApiError ? e.message : 'Nie udało się wysłać przypomnień.', 'error'),
  })

  const { data: day } = useQuery({
    queryKey: ['clinic-day', clinic?.clinic_id, today],
    queryFn: () => api<AppointmentOut[]>(`/clinics/${clinic!.clinic_id}/day?day=${today}`),
    enabled: !!clinic,
    refetchInterval: 60_000,
  })

  const all = day ?? []
  const booked = all.filter(a => a.patient_id && a.appointment_status !== 'CANCELLED')
  const free = all.filter(a => a.appointment_status === 'FREE')
  const completed = booked.filter(a => a.appointment_status === 'COMPLETED')
  const unconfirmed = booked.filter(a => a.appointment_status === 'CONFIRMED' && a.confirmation_requested && !a.patient_confirmed)
  const upcoming = booked
    .filter(a => !FINISHED.includes(a.appointment_status))  // dziś, niezakończone (też spóźnieni)
    .sort((x, y) => x.appointment_datetime.localeCompare(y.appointment_datetime))
    .slice(0, 8)
  const waiting = booked.filter(a => a.checked_in_at && a.appointment_status === 'CONFIRMED').length
  const dayLabel = new Date(today + 'T00:00:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })

  const openPatient = (a: AppointmentOut) => a.patient_id && navigate(`/pacjent/${a.patient_id}`)

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Pulpit"
          sub={`Dziś: ${dayLabel}`}
          action={<ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />}
        />
      </div>

      {day === undefined ? <Loading label="Wczytywanie dnia…" /> : (
        <>
          {/* statystyki dnia */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Wizyty dziś" value={booked.length} hint={`${completed.length} zakończonych${waiting ? ` · ${waiting} czeka` : ''}`} tone="primary" />
            <Stat label="Wolne terminy" value={free.length} hint="do umówienia" />
            <Stat label="Bez potwierdzenia" value={unconfirmed.length} hint={unconfirmed.length ? 'zadzwoń / przypomnij' : 'wszystko potwierdzone'} tone={unconfirmed.length ? 'amber' : undefined} />
            <Stat label="Teleporady dziś" value={booked.filter(a => a.appointment_type === 'ONLINE').length} hint="wideo" />
          </div>

          {/* szybkie akcje */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ACTIONS.map(a => (
              <Link key={a.to} to={a.to}
                className="group flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 tile-shadow transition-transform hover:scale-[1.02]">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <a.icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-extrabold text-gray-900">{a.label}</span>
                  <span className="block truncate text-xs font-medium text-gray-500">{a.desc}</span>
                </span>
                <ChevronRight size={16} className="ml-auto shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* najbliższe wizyty dziś */}
            <Tile className="p-5" delay={60}>
              <TileHeader title="Najbliższe wizyty dziś" action={
                <Link to="/kalendarz" className="text-xs font-extrabold text-primary hover:underline">cały grafik</Link>
              } />
              {upcoming.length === 0 ? (
                <p className="rounded-2xl bg-gray-50 px-4 py-6 text-center text-sm font-medium text-gray-500">Brak kolejnych wizyt dziś.</p>
              ) : (
                <ul className="space-y-1.5">
                  {upcoming.map(a => (
                    <li key={a.appointment_id} className="flex items-center gap-2 rounded-2xl bg-gray-50 px-4 py-2.5">
                      <button onClick={() => openPatient(a)}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
                        <span className="shrink-0 text-base font-extrabold text-gray-900 [font-variant-numeric:tabular-nums]">{formatTime(a.appointment_datetime)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-gray-900">{a.patient_name}</span>
                          <span className="flex items-center gap-1 truncate text-xs font-medium text-gray-500">
                            {a.appointment_type === 'ONLINE' ? <Video size={12} /> : <Clock size={12} />} {a.doctor_name}
                          </span>
                        </span>
                      </button>
                      {a.confirmation_requested && !a.patient_confirmed && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">bez potw.</span>
                      )}
                      {a.appointment_status === 'CONFIRMED' && a.appointment_type !== 'ONLINE' && (
                        a.checked_in_at ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-extrabold text-primary">
                            <UserCheck size={12} /> czeka{a.room ? ` · gab. ${a.room}` : ''}
                            <button type="button" aria-label="Cofnij meldunek" disabled={arrive.isPending}
                              onClick={() => arrive.mutate({ id: a.appointment_id, checked_in: false })}
                              className="ml-0.5 cursor-pointer rounded-full p-0.5 hover:bg-primary/15"><X size={11} /></button>
                          </span>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => { setArriveFor(a); setRoom('') }}>
                            <DoorOpen size={13} /> Przyszedł
                          </Button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Tile>

            {/* wymaga uwagi — niepotwierdzone */}
            <Tile className="p-5" delay={90}>
              <TileHeader title="Wymaga uwagi" action={unconfirmed.length > 0 && (
                <Button size="sm" variant="secondary" disabled={remind.isPending} onClick={() => remind.mutate()}>
                  <BellRing size={13} /> {remind.isPending ? 'Wysyłanie…' : `Przypomnij (${unconfirmed.length})`}
                </Button>
              )} />
              {unconfirmed.length === 0 ? (
                <p className="flex items-center justify-center gap-1.5 rounded-2xl bg-emerald-50 px-4 py-6 text-center text-sm font-bold text-emerald-700"><CheckCircle2 size={15} className="text-emerald-600" /> Wszystkie dzisiejsze wizyty potwierdzone</p>
              ) : (
                <>
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-amber-800">
                    <AlertTriangle size={14} className="text-amber-600" /> {unconfirmed.length} wizyt bez potwierdzenia obecności — SMS na ich numery
                  </p>
                  <ul className="space-y-1.5">
                    {unconfirmed.slice(0, 6).map(a => (
                      <li key={a.appointment_id}>
                        <button onClick={() => openPatient(a)}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-amber-50 px-4 py-2.5 text-left hover:bg-amber-100/70">
                          <span className="shrink-0 text-sm font-extrabold text-amber-900 [font-variant-numeric:tabular-nums]">{formatTime(a.appointment_datetime)}</span>
                          <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{a.patient_name}</span>
                          <span className="truncate text-xs font-medium text-gray-500">{a.doctor_name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Tile>
          </div>
        </>
      )}

      {arriveFor && (
        <Modal
          overline={`${arriveFor.patient_name} · ${formatTime(arriveFor.appointment_datetime)}`}
          title="Pacjent przyszedł"
          onClose={() => setArriveFor(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setArriveFor(null)}>Anuluj</Button>
            <Button disabled={arrive.isPending} onClick={() => arrive.mutate({ id: arriveFor.appointment_id, room })}>
              <UserCheck size={15} /> {arrive.isPending ? 'Meldowanie…' : 'Zamelduj'}
            </Button>
          </>}
        >
          <div className="space-y-3 pb-1">
            <p className="text-sm font-medium text-gray-600">Lekarz <b>{arriveFor.doctor_name}</b> zobaczy, że pacjent czeka. Podaj gabinet, do którego ma się skierować.</p>
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold text-gray-700">Gabinet (opcjonalnie)</span>
              <input className={cx(inputCls, 'font-extrabold tracking-wider')} value={room} placeholder="np. 5"
                maxLength={20} autoFocus
                onChange={e => setRoom(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') arrive.mutate({ id: arriveFor.appointment_id, room }) }} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  )
}
