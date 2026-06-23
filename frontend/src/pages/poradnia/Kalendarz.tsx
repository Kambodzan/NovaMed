// Kalendarz (UC-PP2) — operacyjna TABLICA DNIA recepcji: kto dziś przychodzi i kto
// już jest. Oś pacjent×dzień (dostępność lekarzy = osobny „Grafik").
// Pacjenci pogrupowani wg stanu: Czeka (przyszedł/u lekarza) · Następni · Zakończone;
// meldowanie jednym klikiem (gabinet z konfiguracji), wyszukiwanie po nazwisku pacjenta.
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, ChevronLeft, ChevronRight, DoorOpen, MapPin, Search, UserCheck, Video, X } from 'lucide-react'
import { Button, EmptyState, Loading, Modal, PageHeader, StatusBadge, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import { confirm } from '../../lib/confirm'
import type { AppointmentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { DatePicker } from '../../components/DatePicker'
import { StaffReschedule } from '../../components/StaffReschedule'
import { PaymentCheckIn, needsDeskPayment } from '../../components/PaymentCheckIn'

const DAY_KEY = 'novamed-kalendarz-day'
// data LOKALNA (toISOString daje UTC → strzałki ‹›/„Dziś" skakały o ±dzień)
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => isoLocal(new Date())
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const hm = (iso: string) => iso.slice(11, 16)
const FINISHED = ['COMPLETED', 'NO_SHOW', 'INTERRUPTED']

interface DoctorRow { doctor_id: string; name: string; specializations: string[]; room: string | null }

// inicjały do awatara (bez tytułu „dr/lek/prof")
const initials = (name: string) => name.replace(/^(dr|lek\.?|prof\.?)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')

// tor tablicy dnia (czeka / następni / zakończone) — wspólna ramka z nagłówkiem i licznikiem
function Lane({ title, count, tone, collapsible, open, onToggle, children }: {
  title: string; count: number; tone?: 'primary'; collapsible?: boolean; open?: boolean; onToggle?: () => void; children: ReactNode
}) {
  const head = (
    <div className="mb-2 flex items-center gap-2 px-1">
      <span className={cx('text-xs font-extrabold uppercase tracking-wide', tone === 'primary' ? 'text-primary' : 'text-gray-500')}>{title}</span>
      <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-extrabold [font-variant-numeric:tabular-nums]', tone === 'primary' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}>{count}</span>
      {collapsible && <ChevronRight size={15} className={cx('ml-auto text-gray-400 transition-transform', open && 'rotate-90')} />}
    </div>
  )
  return (
    <Tile className={cx('p-3 sm:p-4', tone === 'primary' && 'ring-1 ring-primary/15')}>
      {collapsible ? <button type="button" onClick={onToggle} className="w-full cursor-pointer">{head}</button> : head}
      {(!collapsible || open) && <ul className="space-y-1.5">{children}</ul>}
    </Tile>
  )
}

export function Kalendarz() {
  const queryClient = useQueryClient()
  const { clinics, clinic, setClinicId } = useClinicSelection()
  const [day, setDayState] = useState(() => sessionStorage.getItem(DAY_KEY) ?? todayIso())
  const setDay = (d: string) => { sessionStorage.setItem(DAY_KEY, d); setDayState(d) }
  const shiftDay = (n: number) => { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); setDay(isoLocal(d)) }
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<AppointmentOut | null>(null)
  const [rescheduleFor, setRescheduleFor] = useState<AppointmentOut | null>(null)
  const [payFor, setPayFor] = useState<AppointmentOut | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [showRooms, setShowRooms] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: items } = useQuery({
    queryKey: ['clinic-day', clinic?.clinic_id, day],
    queryFn: () => api<AppointmentOut[]>(`/clinics/${clinic!.clinic_id}/day?day=${day}`),
    enabled: !!clinic,
  })
  // lekarze placówki — do podpowiedzi gabinetu przy meldowaniu
  const { data: doctors } = useQuery({
    queryKey: ['clinic-doctors', clinic?.clinic_id],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinic!.clinic_id}/doctors`),
    enabled: !!clinic,
  })

  const free = (items ?? []).filter(a => a.appointment_status === 'FREE').length
  const taken = (items ?? []).length - free

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/appointments/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { setDetail(null); void queryClient.invalidateQueries({ queryKey: ['clinic-day'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się odwołać wizyty.'),
  })
  // meldowanie pacjenta jednym klikiem (gabinet z konfiguracji lekarza)
  const arrive = useMutation({
    mutationFn: ({ id, checked_in }: { id: string; checked_in?: boolean }) =>
      api<AppointmentOut>(`/appointments/${id}/arrival`, { method: 'POST', body: { checked_in: checked_in ?? true } }),
    onSuccess: (a) => { setDetail(d => (d?.appointment_id === a.appointment_id ? a : d)); void queryClient.invalidateQueries({ queryKey: ['clinic-day'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zameldować pacjenta.'),
  })
  // „nie stawił się" (nieobecność) — opcja po godzinie spóźnienia; NIE wymuszamy stanu,
  // recepcja klika świadomie. Odwracalne tego samego dnia (lekarz „Rozpocznij" z NO_SHOW)
  const noShow = useMutation({
    mutationFn: (id: string) => api(`/appointments/${id}/status`, { method: 'POST', body: { new_status: 'NO_SHOW' } }),
    onSuccess: () => { setDetail(null); void queryClient.invalidateQueries({ queryKey: ['clinic-day'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się oznaczyć nieobecności.'),
  })
  const markNoShow = async (a: AppointmentOut) => {
    if (await confirm({ title: 'Oznaczyć nieobecność?', message: `${a.patient_name} — ${formatTime(a.appointment_datetime)}. Wizyta trafi do „Zakończone" jako nieodbyta (można cofnąć dziś, gdy pacjent jednak dotrze).`, confirmLabel: 'Nie stawił się' }))
      noShow.mutate(a.appointment_id)
  }
  // meldowanie: jeśli wizyta płatna i nieopłacona → najpierw rozliczenie (modal), potem
  // automatycznie zameldowanie; inaczej od razu „Przyszedł"
  const checkIn = (a: AppointmentOut) => needsDeskPayment(a) ? setPayFor(a) : arrive.mutate({ id: a.appointment_id })
  const doctorRoom = (id: string | null | undefined) => (doctors ?? []).find(d => d.doctor_id === id)?.room ?? null

  // AGENDA = tablica przepływu pacjenta: grupy wg STANU, nie po samej godzinie.
  // Wyszukiwanie po NAZWISKU PACJENTA (gość podchodzi → wpisz → zamelduj).
  const agendaAll = useMemo(() => (items ?? [])
    .filter(a => a.patient_id && a.appointment_status !== 'CANCELLED')
    .sort((x, y) => x.appointment_datetime.localeCompare(y.appointment_datetime)), [items])
  const waitingCount = agendaAll.filter(a => a.checked_in_at && a.appointment_status === 'CONFIRMED').length
  const agenda = useMemo(() => {
    const needle = fold(q.trim())
    return needle
      ? agendaAll.filter(a => fold(`${a.patient_name ?? ''} ${a.doctor_name ?? ''} ${a.service_name ?? ''} ${a.specializations.join(' ')}`).includes(needle))
      : agendaAll
  }, [agendaAll, q])
  // „teraz" tylko dla dnia dzisiejszego — do flagowania spóźnionych (minęła godzina, brak meldunku)
  const nowMin = day === todayIso() ? (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })() : null
  const minOf = (a: AppointmentOut) => { const [h, m] = hm(a.appointment_datetime).split(':').map(Number); return h * 60 + m }
  const board = useMemo(() => {
    const here: AppointmentOut[] = [], next: AppointmentOut[] = [], done: AppointmentOut[] = []
    for (const a of agenda) {
      if (FINISHED.includes(a.appointment_status)) done.push(a)
      else if ((a.checked_in_at && a.appointment_status === 'CONFIRMED') || a.appointment_status === 'IN_PROGRESS' || a.appointment_status === 'PAUSED') here.push(a)
      else next.push(a)
    }
    return { here, next, done }
  }, [agenda])

  const doCancel = async (a: AppointmentOut) => {
    if (await confirm({ title: 'Odwołać wizytę?', message: `${a.patient_name} — ${formatTime(a.appointment_datetime)}. Pacjent dostanie powiadomienie.`, tone: 'danger', confirmLabel: 'Odwołaj' }))
      cancel.mutate(a.appointment_id)
  }

  // wiersz tablicy — wspólny dla wszystkich torów; gabinet i meldunek wyróżnione,
  // spóźnienie flagowane na czerwono (minęła godzina, pacjent się nie zameldował)
  const agendaRow = (a: AppointmentOut) => {
    const live = a.appointment_status === 'IN_PROGRESS'
    const paused = a.appointment_status === 'PAUSED'
    const done = FINISHED.includes(a.appointment_status)
    const online = a.appointment_type === 'ONLINE'
    const room = online ? null : (a.room ?? doctorRoom(a.doctor_id))  // teleporada nie ma gabinetu
    const waiting = !!a.checked_in_at && a.appointment_status === 'CONFIRMED'
    // meldowanie TYLKO dla dnia dzisiejszego — w przyszłym dniu „Przyszedł" to missclick i afera
    const canCheckIn = a.appointment_status === 'CONFIRMED' && !online && !waiting && day === todayIso()
    const late = canCheckIn && nowMin != null && minOf(a) < nowMin
    // ponad godzinę spóźnienia → opcja „nie stawił się" (do kliknięcia, nie wymuszana)
    const veryLate = late && nowMin != null && nowMin - minOf(a) > 60
    return (
      <li key={a.appointment_id} className={cx('flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-4 py-2.5',
        live ? 'bg-primary-soft ring-1 ring-primary' : paused ? 'bg-amber-50 ring-1 ring-amber-200'
          : done ? 'bg-gray-50 opacity-60' : waiting ? 'bg-primary-soft' : late ? 'bg-red-50/70' : 'bg-gray-50')}>
        <span className={cx('w-12 shrink-0 text-base font-extrabold [font-variant-numeric:tabular-nums]', late ? 'text-red-600' : 'text-gray-900')}>{formatTime(a.appointment_datetime)}</span>
        <button onClick={() => { setError(null); setDetail(a) }} className="flex min-w-0 flex-1 cursor-pointer flex-col text-left">
          <span className="truncate text-sm font-extrabold text-gray-900">{a.patient_name}</span>
          <span className="flex items-center gap-1 truncate text-xs font-medium text-gray-500">
            {online ? <Video size={12} /> : <MapPin size={12} />} {a.doctor_id ? a.doctor_name : a.service_name}
            {a.doctor_id && a.service_name ? ` · ${a.service_name}` : ''}{room ? ` · gab. ${room}` : ''}
          </span>
        </button>
        {late && <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-extrabold text-red-700">spóźniony</span>}
        {a.appointment_status === 'CONFIRMED' && a.confirmation_requested && !waiting && !late && (
          <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold',
            a.patient_confirmed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
            {a.patient_confirmed ? 'potw.' : 'bez potw.'}
          </span>
        )}
        {(live || paused || done) && <StatusBadge status={a.appointment_status} />}
        {a.appointment_status === 'CONFIRMED' && (
          <span className="flex shrink-0 items-center gap-0.5">
            <button type="button" onClick={() => { setError(null); setRescheduleFor(a) }}
              className="cursor-pointer rounded-full px-2.5 py-1 text-xs font-extrabold text-gray-600 hover:bg-gray-200/70">Przełóż</button>
            <button type="button" disabled={cancel.isPending} onClick={() => void doCancel(a)}
              className="cursor-pointer rounded-full px-2.5 py-1 text-xs font-extrabold text-red-600 hover:bg-red-50">Odwołaj</button>
          </span>
        )}
        {waiting ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-extrabold text-white">
            <UserCheck size={12} /> czeka{room ? ` · gab. ${room}` : ''}
            <button type="button" aria-label="Cofnij meldunek" disabled={arrive.isPending}
              onClick={() => arrive.mutate({ id: a.appointment_id, checked_in: false })}
              className="ml-0.5 cursor-pointer rounded-full p-0.5 hover:bg-white/20"><X size={11} /></button>
          </span>
        ) : canCheckIn ? (
          <span className="flex shrink-0 items-center gap-1">
            {veryLate && (
              <button type="button" disabled={noShow.isPending} onClick={() => void markNoShow(a)}
                className="cursor-pointer rounded-full px-2.5 py-1 text-xs font-extrabold text-amber-700 hover:bg-amber-100">Nie stawił się</button>
            )}
            <Button size="sm" variant="primary" disabled={arrive.isPending} onClick={() => checkIn(a)}>
              <DoorOpen size={13} /> {needsDeskPayment(a) ? `Przyszedł · ${a.price} zł` : 'Przyszedł'}
            </Button>
          </span>
        ) : online && a.appointment_status === 'CONFIRMED' ? (
          // teleporada: nic do meldowania — sama informacja. Link wysyła pacjentowi
          // automat ~15 min przed startem (osobne przypomnienie z linkiem)
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-extrabold text-sky-700">
            <Video size={12} /> Teleporada online
          </span>
        ) : null}
      </li>
    )
  }

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Kalendarz"
          sub={items
            ? `${formatDatePL(day + 'T00:00:00')} · ${taken} zajętych · ${free} wolnych${waitingCount ? ` · ${waitingCount} czeka` : ''}`
            : 'Kto dziś przychodzi i kto już jest'}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />
              <div className="flex items-center gap-1">
                <button onClick={() => shiftDay(-1)} aria-label="Poprzedni dzień" className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
                <DatePicker className="w-40" value={day} onChange={setDay} />
                <button onClick={() => shiftDay(1)} aria-label="Następny dzień" className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
                {day !== todayIso() && <Button variant="ghost" size="sm" onClick={() => setDay(todayIso())}>Dziś</Button>}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setShowRooms(true)}><DoorOpen size={14} /> Gabinety</Button>
            </div>
          }
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      {/* szukaj pacjenta (gość podchodzi → wpisz nazwisko → zamelduj) */}
      {agendaAll.length > 0 && (
        <div className="relative max-w-md fade-up">
          <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-500" />
          <input className={cx(inputCls, 'w-full pl-10 pr-8')} placeholder="Szukaj pacjenta lub lekarza…"
            value={q} onChange={e => setQ(e.target.value)} />
          {q && <button onClick={() => setQ('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-gray-500 hover:text-gray-700"><X size={14} /></button>}
        </div>
      )}

      {items === undefined ? <Loading /> : agendaAll.length === 0 ? (
        <Tile className="p-5">
          <EmptyState icon={<CalendarRange size={28} strokeWidth={1.5} />}
            title="Brak umówionych wizyt tego dnia"
            hint={free > 0 ? `${free} wolnych terminów — umów pacjenta z „Grafiku" lub „Umów wizytę".` : 'Dodaj terminy w „Grafiku", aby umawiać pacjentów.'} />
        </Tile>
      ) : agenda.length === 0 ? (
        <Tile className="p-5">
          <EmptyState icon={<Search size={26} strokeWidth={1.5} />} title="Brak pacjenta dla frazy"
            hint="Wyczyść wyszukiwanie albo wpisz inne nazwisko." />
        </Tile>
      ) : (
        <div className="space-y-3 fade-up">
          {board.here.length > 0 && (
            <Lane title="Czeka" count={board.here.length} tone="primary">
              {board.here.map(a => agendaRow(a))}
            </Lane>
          )}
          {board.next.length > 0 && (
            <Lane title="Następni" count={board.next.length}>
              {board.next.map(a => agendaRow(a))}
            </Lane>
          )}
          {board.done.length > 0 && (
            <Lane title="Zakończone" count={board.done.length} collapsible open={showDone} onToggle={() => setShowDone(s => !s)}>
              {showDone ? board.done.map(a => agendaRow(a)) : null}
            </Lane>
          )}
        </div>
      )}

      {/* szczegóły wizyty (zawsze umówiony pacjent — wolne sloty są w Grafiku) */}
      {detail && (
        <Modal title="Wizyta" onClose={() => setDetail(null)}
          overline={`${formatDatePL(detail.appointment_datetime)}, ${formatTime(detail.appointment_datetime)}`}
          footer={
            <>
              {!FINISHED.includes(detail.appointment_status) && detail.appointment_status !== 'CANCELLED' && (
                <>
                  <Button variant="ghost" disabled={cancel.isPending} onClick={() => void doCancel(detail)}>Odwołaj</Button>
                  <Button variant="secondary" onClick={() => { setRescheduleFor(detail); setDetail(null) }}>Przełóż</Button>
                </>
              )}
              {detail.patient_id && <Link to={`/pacjent/${detail.patient_id}`}><Button>Kartoteka pacjenta</Button></Link>}
            </>
          }>
          <div className="space-y-1 text-sm">
            <p><span className="font-semibold text-gray-500">Lekarz:</span> <span className="font-bold text-gray-900">{detail.doctor_id ? detail.doctor_name : 'Pracownia (badanie)'}</span></p>
            {detail.specializations.length > 0 && <p><span className="font-semibold text-gray-500">Specjalizacja:</span> {detail.specializations.join(' · ')}</p>}
            <p><span className="font-semibold text-gray-500">Forma:</span> {detail.appointment_type === 'ONLINE' ? 'teleporada (wideo)' : 'stacjonarna'}{detail.price ? ` · ${detail.price} zł` : ' · NFZ'}</p>
            <p><span className="font-semibold text-gray-500">Pacjent:</span> <span className="font-bold text-gray-900">{detail.patient_name ?? '—'}</span></p>
            <p className="flex items-center gap-2"><span className="font-semibold text-gray-500">Status:</span> <StatusBadge status={detail.appointment_status} /></p>
            {detail.appointment_status === 'CONFIRMED' && (
              <p><span className="font-semibold text-gray-500">Obecność:</span>{' '}
                {detail.patient_confirmed
                  ? <span className="font-bold text-emerald-700">potwierdzona przez pacjenta</span>
                  : detail.confirmation_requested
                    ? <span className="font-bold text-amber-700">wysłano prośbę — czeka na potwierdzenie</span>
                    : <span className="text-gray-500">brak prośby o potwierdzenie</span>}
              </p>
            )}
            {detail.notes && <p><span className="font-semibold text-gray-500">Powód:</span> {detail.notes}</p>}
            {detail.price ? (
              <p><span className="font-semibold text-gray-500">Płatność:</span>{' '}
                {detail.payment_status === 'PAID'
                  ? <span className="font-bold text-emerald-700">opłacona{detail.invoice_number ? ` · faktura ${detail.invoice_number}` : ''}</span>
                  : <span className="font-bold text-amber-700">do zapłaty {detail.price} zł (na miejscu)</span>}
              </p>
            ) : null}
            {detail.appointment_status === 'CONFIRMED' && detail.appointment_type !== 'ONLINE' && day === todayIso() && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3.5 py-2.5">
                <span><span className="font-semibold text-gray-500">Meldunek: </span>
                  {detail.checked_in_at
                    ? <span className="font-bold text-primary">pacjent czeka{(detail.room ?? doctorRoom(detail.doctor_id)) ? ` · gab. ${detail.room ?? doctorRoom(detail.doctor_id)}` : ''}</span>
                    : <span className="text-gray-500">jeszcze nie zameldowany</span>}
                </span>
                {detail.checked_in_at ? (
                  <Button size="sm" variant="ghost" disabled={arrive.isPending} onClick={() => arrive.mutate({ id: detail.appointment_id, checked_in: false })}>Cofnij</Button>
                ) : (
                  <Button size="sm" variant="primary" disabled={arrive.isPending} onClick={() => checkIn(detail)}><DoorOpen size={13} /> {needsDeskPayment(detail) ? `Przyszedł · ${detail.price} zł` : 'Przyszedł'}</Button>
                )}
              </div>
            )}
            {detail.appointment_status === 'CONFIRMED' && detail.appointment_type === 'ONLINE' && (
              <div className="mt-2 flex items-start gap-2 rounded-xl bg-sky-50 px-3.5 py-2.5">
                <Video size={15} className="mt-0.5 shrink-0 text-sky-700" />
                <span className="text-sm font-medium text-sky-800">Teleporada — nie ma czego meldować. Pacjent dołącza z linku, który wysyłamy automatycznie ~15 min przed startem (osobno od przypomnienia 24 h).</span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {rescheduleFor && (
        <StaffReschedule visit={rescheduleFor} onClose={() => setRescheduleFor(null)}
          onDone={() => { setRescheduleFor(null); void queryClient.invalidateQueries({ queryKey: ['clinic-day'] }) }} />
      )}

      {payFor && (
        <PaymentCheckIn appt={payFor} onClose={() => setPayFor(null)}
          onDone={() => { setPayFor(null); void queryClient.invalidateQueries({ queryKey: ['clinic-day'] }) }} />
      )}

      {showRooms && clinic && <GabinetyModal clinicId={clinic.clinic_id} clinicName={clinic.clinic_name} onClose={() => setShowRooms(false)} />}
    </div>
  )
}

// ---- modal: gabinety lekarzy tej PLACÓWKI (ustawia recepcja przydzielona tutaj) ----
function GabinetyModal({ clinicId, clinicName, onClose }: { clinicId: string; clinicName: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const { data: docs } = useQuery({
    queryKey: ['clinic-doctors', clinicId],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinicId}/doctors`),
  })
  const setRoom = useMutation({
    mutationFn: ({ id, room }: { id: string; room: string | null }) =>
      api(`/clinics/${clinicId}/doctors/${id}/room`, { method: 'PATCH', body: { room } }),
    onSuccess: () => { setErr(null); void qc.invalidateQueries({ queryKey: ['clinic-doctors', clinicId] }) },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Nie udało się zapisać gabinetu.'),
  })
  const [q, setQ] = useState('')
  const filtered = (docs ?? []).filter(d => !q.trim() || fold(d.name).includes(fold(q.trim())))
  return (
    <Modal title="Gabinety lekarzy" overline={clinicName} onClose={onClose} footer={<Button onClick={onClose}>Gotowe</Button>}>
      <p className="mb-3 text-sm font-medium text-gray-500">Gdzie dziś który lekarz przyjmuje — numer podpowiada się przy meldowaniu pacjenta.</p>
      {!docs ? <Loading /> : docs.length === 0 ? (
        <p className="rounded-2xl bg-gray-50 px-4 py-6 text-center text-sm font-medium text-gray-500">Brak lekarzy w tej placówce.</p>
      ) : (
        <>
          <div className="relative mb-2">
            <Search size={14} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-500" />
            <input className={cx(inputCls, 'w-full pl-9 pr-8 text-sm')} placeholder="Szukaj lekarza…" value={q} onChange={e => setQ(e.target.value)} />
            {q && <button onClick={() => setQ('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-gray-500 hover:text-gray-700"><X size={13} /></button>}
          </div>
          {filtered.length === 0 ? (
            <p className="rounded-2xl bg-gray-50 px-4 py-6 text-center text-sm font-medium text-gray-500">Brak lekarza dla frazy.</p>
          ) : (
            <div className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
              {filtered.map(d => (
                <div key={d.doctor_id} className="flex items-center gap-3 rounded-2xl bg-gray-50 px-3.5 py-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-extrabold text-primary">{initials(d.name)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-gray-900">{d.name}</span>
                  <span className="shrink-0 text-xs font-bold text-gray-400">gab.</span>
                  <div className="w-20 shrink-0">
                    <input type="text" maxLength={20} defaultValue={d.room ?? ''} placeholder="—"
                      aria-label={`Gabinet — ${d.name}`} className={cx(inputCls, 'w-full text-center')}
                      onBlur={e => { const v = e.target.value.trim() || null; if (v !== d.room) setRoom.mutate({ id: String(d.doctor_id), room: v }) }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {err && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{err}</p>}
    </Modal>
  )
}
