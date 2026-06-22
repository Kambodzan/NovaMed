// Kalendarz lekarzy (UC-PP2) — serce rejestracji: czytelny grid „kto ma co o
// której" (godziny × lekarze) na wybrany dzień. Klik komórki: wolny → umów/usuń,
// zajęty → kartoteka/odwołaj. Zarządzanie terminami i ustawienia placówki scalone
// w modalach (dawne „Terminy").
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Check, ChevronLeft, ChevronRight, Plus, Search, Settings2, Video, X } from 'lucide-react'
import { Button, EmptyState, Field, Loading, Modal, PageHeader, StatusBadge, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDatePL, formatTime } from '../../lib/format'
import { confirm } from '../../lib/confirm'
import type { AppointmentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { DatePicker } from '../../components/DatePicker'
import { TimePicker } from '../../components/TimePicker'
import { Select } from '../../components/Select'

const DAY_KEY = 'novamed-kalendarz-day'
// data LOKALNA (toISOString daje UTC → strzałki ‹›/„Dziś" skakały o ±dzień)
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => isoLocal(new Date())
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const hm = (iso: string) => iso.slice(11, 16)
const FINISHED = ['COMPLETED', 'NO_SHOW', 'INTERRUPTED']
import { ServicesManager, type ServiceOut } from '../../components/ServicesManager'

interface DoctorRow { doctor_id: string; name: string; specializations: string[]; slot_duration_min: number | null }

export function Kalendarz() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { me } = useAuth()
  // ustawienia placówki (polityka) zmienia tylko kierownik/administrator, nie rejestracja
  const canManage = me?.role === 'kierownik' || me?.role === 'administrator'
  const { clinics, clinic, setClinicId } = useClinicSelection()
  const [day, setDayState] = useState(() => sessionStorage.getItem(DAY_KEY) ?? todayIso())
  const setDay = (d: string) => { sessionStorage.setItem(DAY_KEY, d); setDayState(d) }
  const shiftDay = (n: number) => { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); setDay(isoLocal(d)) }
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<AppointmentOut | null>(null)
  const [modal, setModal] = useState<'add' | 'settings' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: items } = useQuery({
    queryKey: ['clinic-day', clinic?.clinic_id, day],
    queryFn: () => api<AppointmentOut[]>(`/clinics/${clinic!.clinic_id}/day?day=${day}`),
    enabled: !!clinic,
  })
  // WSZYSCY lekarze placówki — żeby w pusty dzień też dało się znaleźć lekarza
  const { data: doctors } = useQuery({
    queryKey: ['clinic-doctors', clinic?.clinic_id],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinic!.clinic_id}/doctors`),
    enabled: !!clinic,
  })
  // wszystkie wolne terminy placówki — do „najbliższy wolny" per lekarz
  const { data: allFree } = useQuery({
    queryKey: ['clinic-slots', clinic?.clinic_id],
    queryFn: () => api<AppointmentOut[]>(`/slots?clinic_id=${clinic!.clinic_id}`),
    enabled: !!clinic,
  })

  // najbliższy wolny termin per lekarz (+ Pracownia '__exam')
  const nextFree = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of allFree ?? []) {
      const k = s.doctor_id ?? '__exam'
      const cur = m.get(k)
      if (!cur || s.appointment_datetime < cur) m.set(k, s.appointment_datetime)
    }
    return m
  }, [allFree])

  // kolumny = WSZYSCY lekarze placówki (+ Pracownia, jeśli są badania), zawężane wyszukiwarką
  const columns = useMemo(() => {
    const cols: { key: string; label: string; specs: string[] }[] =
      (doctors ?? []).map(d => ({ key: d.doctor_id, label: d.name, specs: d.specializations }))
    const hasExam = [...(items ?? []), ...(allFree ?? [])].some(a => a.doctor_id == null)
    if (hasExam) cols.push({ key: '__exam', label: 'Pracownia', specs: [] })
    const needle = fold(q.trim())
    const out = needle ? cols.filter(c => fold(`${c.label} ${c.specs.join(' ')}`).includes(needle)) : cols
    return out.sort((a, b) => (a.key === '__exam' ? 1 : 0) - (b.key === '__exam' ? 1 : 0) || a.label.localeCompare(b.label))
  }, [doctors, items, allFree, q])

  const visibleKeys = new Set(columns.map(c => c.key))
  const visible = (items ?? []).filter(a => visibleKeys.has(a.doctor_id ?? '__exam'))
  const times = useMemo(() => [...new Set(visible.map(a => hm(a.appointment_datetime)))].sort(), [visible])
  const cell = (time: string, key: string) => {
    // gdyby na jeden slot przypadło kilka wpisów (np. wolny + zajęty po artefakcie
    // danych) — pokazujemy ZAJĘTĄ wizytę, nie wolny slot (nie chowamy pacjenta)
    const m = visible.filter(a => hm(a.appointment_datetime) === time && (a.doctor_id ?? '__exam') === key)
    return m.find(a => a.appointment_status !== 'FREE') ?? m[0]
  }

  const free = (items ?? []).filter(a => a.appointment_status === 'FREE').length
  const taken = (items ?? []).length - free

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/appointments/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { setDetail(null); void queryClient.invalidateQueries({ queryKey: ['clinic-day'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się odwołać wizyty.'),
  })
  const removeSlot = useMutation({
    mutationFn: (id: string) => api(`/slots/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setDetail(null); void queryClient.invalidateQueries({ queryKey: ['clinic-day'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się usunąć terminu.'),
  })

  const doCancel = async (a: AppointmentOut) => {
    if (await confirm({ title: 'Odwołać wizytę?', message: `${a.patient_name} — ${formatTime(a.appointment_datetime)}. Pacjent dostanie powiadomienie.`, tone: 'danger', confirmLabel: 'Odwołaj' }))
      cancel.mutate(a.appointment_id)
  }

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Kalendarz lekarzy"
          sub={items ? `${formatDatePL(day + 'T00:00:00')} · ${taken} zajętych · ${free} wolnych` : 'Kto ma co o której — obłożenie dnia'}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />
              <div className="flex items-center gap-1">
                <button onClick={() => shiftDay(-1)} aria-label="Poprzedni dzień" className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ChevronLeft size={16} /></button>
                <DatePicker className="w-40" value={day} onChange={setDay} />
                <button onClick={() => shiftDay(1)} aria-label="Następny dzień" className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100"><ChevronRight size={16} /></button>
                {day !== todayIso() && <Button variant="ghost" size="sm" onClick={() => setDay(todayIso())}>Dziś</Button>}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setModal('add')}><Plus size={14} /> Dodaj terminy</Button>
              {canManage && <Button variant="secondary" size="sm" onClick={() => setModal('settings')}><Settings2 size={14} /> Ustawienia</Button>}
            </div>
          }
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      {/* filtr lekarza/specjalizacji */}
      {(items?.length ?? 0) > 0 && (
        <div className="relative max-w-md fade-up">
          <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-500" />
          <input className={cx(inputCls, 'w-full pl-10 pr-8')} placeholder="Filtruj: lekarz lub specjalizacja…"
            value={q} onChange={e => setQ(e.target.value)} />
          {q && <button onClick={() => setQ('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-gray-500 hover:text-gray-700"><X size={14} /></button>}
        </div>
      )}

      {items === undefined ? <Loading /> : columns.length === 0 ? (
        <Tile className="p-5">
          <EmptyState icon={<CalendarRange size={28} strokeWidth={1.5} />}
            title={q ? 'Brak lekarzy dla filtra' : 'Brak lekarzy w placówce'}
            hint={q ? 'Zmień frazę wyszukiwania.' : 'Przypisz lekarzy do placówki w Panelu Admina.'} />
        </Tile>
      ) : (
        <Tile className="overflow-x-auto p-0">
          {times.length === 0 && (
            <p className="border-b border-gray-100 bg-amber-50/60 px-4 py-2.5 text-sm font-semibold text-amber-800">
              Brak terminów w tym dniu — „najbliższy wolny" przy każdym lekarzu (klik = przejdź do tego dnia).
            </p>
          )}
          {/* w-max + jawna min-szerokość: kolumny NIE kompaktują się przy wąskim oknie,
              tylko poziomy scroll (time 64px + kolumny po 176px) */}
          <div className="w-max" style={{ minWidth: 64 + columns.length * 176 }}>
            {/* nagłówek z lekarzami + najbliższy wolny termin */}
            <div className="sticky top-0 z-10 flex border-b border-gray-100 bg-surface/95 backdrop-blur">
              <div className="w-16 shrink-0" />
              {columns.map(c => {
                const nf = nextFree.get(c.key)
                return (
                  <div key={c.key} className="w-44 shrink-0 px-3 py-2.5">
                    <p className="truncate text-sm font-extrabold text-gray-900">{c.label}</p>
                    {c.specs.length > 0 && <p className="truncate text-[11px] font-semibold text-gray-500">{c.specs.join(' · ')}</p>}
                    {!nf ? (
                      <p className="text-[10px] font-bold text-gray-300">brak wolnych terminów</p>
                    ) : nf.slice(0, 10) !== day ? (
                      <button onClick={() => setDay(nf.slice(0, 10))} className="cursor-pointer text-[10px] font-extrabold text-primary hover:underline">
                        najbliższy: {new Date(nf).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
                      </button>
                    ) : <p className="text-[10px] font-bold text-emerald-600">wolne dziś</p>}
                  </div>
                )
              })}
            </div>
            {/* wiersze godzin */}
            {times.map(t => (
              <div key={t} className="flex border-b border-gray-50 last:border-0">
                <div className="w-16 shrink-0 px-3 py-2 text-xs font-extrabold text-gray-500 [font-variant-numeric:tabular-nums]">{t}</div>
                {columns.map(c => {
                  const a = cell(t, c.key)
                  if (!a) return <div key={c.key} className="w-44 shrink-0 px-1.5 py-1.5"><div className="h-full min-h-9 rounded-lg" /></div>
                  const isFree = a.appointment_status === 'FREE'
                  const live = a.appointment_status === 'IN_PROGRESS'
                  const paused = a.appointment_status === 'PAUSED'
                  const done = FINISHED.includes(a.appointment_status)
                  return (
                    <div key={c.key} className="w-44 shrink-0 px-1.5 py-1.5">
                      <button onClick={() => { setError(null); setDetail(a) }}
                        className={cx('flex h-full min-h-9 w-full cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                          isFree ? 'border border-dashed border-gray-200 text-gray-500 hover:border-primary hover:text-primary'
                            : live ? 'bg-primary-soft ring-1 ring-primary'
                            : paused ? 'bg-amber-50 ring-1 ring-amber-200'
                            : done ? 'bg-gray-50 opacity-60' : 'bg-gray-50 hover:bg-gray-100')}>
                        {a.appointment_type === 'ONLINE' && <Video size={11} className="shrink-0 opacity-60" />}
                        {isFree ? (
                          <span className="flex items-center gap-1 text-xs font-bold"><Plus size={12} /> {a.price ? `${a.price} zł` : 'wolny'}</span>
                        ) : (
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-bold text-gray-900">{a.patient_name ?? a.service_name}</span>
                            {a.appointment_status === 'CONFIRMED' && (
                              a.patient_confirmed
                                ? <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600"><Check size={10} /> potwierdzona</span>
                                : a.confirmation_requested
                                  ? <span className="block text-[10px] font-bold text-amber-600">czeka na potw.</span>
                                  : null
                            )}
                          </span>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </Tile>
      )}

      {/* szczegóły komórki */}
      {detail && (
        <Modal title={detail.appointment_status === 'FREE' ? 'Wolny termin' : 'Wizyta'} onClose={() => setDetail(null)}
          overline={`${formatDatePL(detail.appointment_datetime)}, ${formatTime(detail.appointment_datetime)}`}
          footer={detail.appointment_status === 'FREE' ? (
            <>
              <Button variant="ghost" disabled={removeSlot.isPending}
                onClick={async () => { if (await confirm({ title: 'Usunąć wolny termin?', tone: 'danger', confirmLabel: 'Usuń' })) removeSlot.mutate(detail.appointment_id) }}>
                Usuń termin
              </Button>
              <Button onClick={() => navigate('/umow', { state: { slot: detail } })}>Umów pacjenta</Button>
            </>
          ) : (
            <>
              {!FINISHED.includes(detail.appointment_status) && detail.appointment_status !== 'CANCELLED' && (
                <Button variant="ghost" disabled={cancel.isPending} onClick={() => void doCancel(detail)}>Odwołaj wizytę</Button>
              )}
              {detail.patient_id && <Link to={`/pacjent/${detail.patient_id}`}><Button>Kartoteka pacjenta</Button></Link>}
            </>
          )}>
          <div className="space-y-1 text-sm">
            <p><span className="font-semibold text-gray-500">Lekarz:</span> <span className="font-bold text-gray-900">{detail.doctor_id ? detail.doctor_name : 'Pracownia (badanie)'}</span></p>
            {detail.specializations.length > 0 && <p><span className="font-semibold text-gray-500">Specjalizacja:</span> {detail.specializations.join(' · ')}</p>}
            <p><span className="font-semibold text-gray-500">Forma:</span> {detail.appointment_type === 'ONLINE' ? 'teleporada (wideo)' : 'stacjonarna'}{detail.price ? ` · ${detail.price} zł` : ' · NFZ'}</p>
            {detail.appointment_status !== 'FREE' && (
              <>
                <p><span className="font-semibold text-gray-500">Pacjent:</span> <span className="font-bold text-gray-900">{detail.patient_name ?? '—'}</span></p>
                <p className="flex items-center gap-2"><span className="font-semibold text-gray-500">Status:</span> <StatusBadge status={detail.appointment_status} /></p>
                {detail.appointment_status === 'CONFIRMED' && (
                  <p><span className="font-semibold text-gray-500">Obecność:</span>{' '}
                    {detail.patient_confirmed
                      ? <span className="font-bold text-emerald-600">potwierdzona przez pacjenta</span>
                      : detail.confirmation_requested
                        ? <span className="font-bold text-amber-600">wysłano prośbę — czeka na potwierdzenie</span>
                        : <span className="text-gray-500">brak prośby o potwierdzenie</span>}
                  </p>
                )}
                {detail.notes && <p><span className="font-semibold text-gray-500">Powód:</span> {detail.notes}</p>}
              </>
            )}
          </div>
        </Modal>
      )}

      {modal === 'add' && <DodajTerminy clinicId={clinic!.clinic_id} defaultDay={day} interval={clinic?.slot_interval_min ?? 15}
        onClose={() => setModal(null)} onAdded={() => void queryClient.invalidateQueries({ queryKey: ['clinic-day'] })} />}
      {modal === 'settings' && clinic && <UstawieniaPlacowki clinic={clinic} onClose={() => setModal(null)} />}
    </div>
  )
}

// generuje godziny startu slotów od „from" (włącznie) do „to" (wyłącznie) co `step` min;
// gdy zakres pusty/odwrotny → pojedynczy slot o godzinie „from"
const slotTimes = (from: string, to: string, step: number): string[] => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const min = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
  const a = min(from), b = min(to)
  if (b <= a || !step) return [from]
  const out: string[] = []
  for (let m = a; m < b; m += step) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  return out
}

// ---- modal: dodawanie terminów (dawne „Terminy") ----
function DodajTerminy({ clinicId, defaultDay, interval, onClose, onAdded }: {
  clinicId: string; defaultDay: string; interval: number; onClose: () => void; onAdded: () => void
}) {
  const [form, setForm] = useState({
    kind: 'visit', service: '', service_id: '', doctor_id: '', date: defaultDay, from: '09:00', to: '14:00',
    modality: 'STATIONARY', price: '', weeks: '1',
  })
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const { data: doctors } = useQuery({
    queryKey: ['clinic-doctors', clinicId],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinicId}/doctors`),
  })
  const { data: services } = useQuery({
    queryKey: ['clinic-services', clinicId],
    queryFn: () => api<ServiceOut[]>(`/clinics/${clinicId}/services`),
  })
  const doctorId = form.doctor_id || String(doctors?.[0]?.doctor_id ?? '')
  const selectedDoctor = doctors?.find(d => String(d.doctor_id) === doctorId)
  // usługi, które wykonuje wybrany lekarz (typy wizyt z katalogu)
  const docServices = (services ?? []).filter(s => s.doctor_ids.includes(doctorId))
  const pickedService = docServices.find(s => s.service_id === form.service_id) ?? null
  // krok siatki: czas usługi → długość wizyty lekarza → siatka placówki
  const effInterval = form.kind === 'visit'
    ? (pickedService?.duration_min ?? selectedDoctor?.slot_duration_min ?? interval)
    : interval
  // zakres Od–Do → wszystkie sloty dnia co krok siatki; × powtarzanie tygodniowe
  const dayTimes = slotTimes(form.from, form.to, effInterval)
  const weeks = Math.max(1, Number(form.weeks) || 1)
  const totalSlots = dayTimes.length * weeks

  const add = useMutation({
    mutationFn: () => {
      const pad = (n: number) => String(n).padStart(2, '0')
      const datetimes: string[] = []
      for (let w = 0; w < weeks; w++) {
        for (const t of dayTimes) {
          const d = new Date(`${form.date}T${t}:00`); d.setDate(d.getDate() + w * 7)
          datetimes.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${t}:00`)
        }
      }
      return api(`/clinics/${clinicId}/slots`, {
        method: 'POST',
        body: {
          doctor_id: form.kind === 'visit' ? doctorId : null,
          // usługa z katalogu: nazwa/cena/czas/skierowanie bierze backend z usługi
          service_id: form.kind === 'visit' && form.service_id ? form.service_id : null,
          service_name: form.kind === 'exam' ? form.service.trim() : null,
          datetimes,
          appointment_type: form.modality === 'ONLINE' ? 'ONLINE' : 'STATIONARY',
          allow_online: form.modality !== 'STATIONARY_ONLY',
          // przy usłudze cena pochodzi z usługi — nie wysyłamy ręcznej
          price: form.kind === 'visit' && form.service_id ? null : (form.price ? Number(form.price) : null),
        },
      })
    },
    onSuccess: () => {
      setError(null)
      setOk(`Dodano ${totalSlots} ${totalSlots === 1 ? 'termin' : 'terminów'}` +
        (weeks > 1 ? ` (${dayTimes.length}/dzień × ${weeks} tyg.).` : ` (${form.from}–${form.to}).`))
      onAdded()
    },
    onError: (e) => { setOk(null); setError(e instanceof ApiError ? e.message : 'Nie udało się dodać terminu.') },
  })

  return (
    <Modal title="Dodaj terminy" overline="nowe wolne sloty w kalendarzu lekarza / pracowni" onClose={onClose} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Zamknij</Button>
        <Button disabled={add.isPending || (form.kind === 'visit' && !doctorId) || totalSlots < 1 || totalSlots > 400}
          onClick={() => add.mutate()}><Plus size={15} /> Dodaj {totalSlots > 1 ? `(${totalSlots})` : ''}</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rodzaj">
          <Select value={form.kind} onChange={v => setForm(f => ({ ...f, kind: v }))}
            options={[{ value: 'visit', label: 'wizyta lekarska' }, { value: 'exam', label: 'badanie (pracownia)' }]} />
        </Field>
        {form.kind === 'visit' ? (
          <>
          <Field label="Lekarz">
            <Select value={doctorId} onChange={v => setForm(f => ({ ...f, doctor_id: v, service_id: '' }))}
              options={(doctors ?? []).map(d => ({ value: String(d.doctor_id), label: d.name, hint: d.specializations.join(' · ') || undefined }))} />
          </Field>
          <Field label="Usługa (typ wizyty)" hint={docServices.length === 0 ? 'lekarz nie ma przypiętych usług — zwykła wizyta NFZ' : 'czas i cena z usługi'}>
            <Select value={form.service_id} onChange={v => setForm(f => ({ ...f, service_id: v }))}
              options={[{ value: '', label: 'Zwykła wizyta (NFZ)' },
                ...docServices.map(s => ({ value: s.service_id, label: s.name, hint: `${s.duration_min} min · ${s.price != null ? `${s.price} zł` : 'NFZ'}` }))]} />
          </Field>
          </>
        ) : (
          <Field label="Badanie" hint="bez ceny = NFZ (wymaga skierowania); z ceną = prywatne">
            <input className={inputCls} minLength={2} value={form.service} placeholder="np. RTG klatki piersiowej"
              onChange={e => setForm(f => ({ ...f, service: e.target.value }))} />
          </Field>
        )}
        <Field label="Data"><DatePicker value={form.date} min={new Date().toISOString().slice(0, 10)} onChange={v => setForm(f => ({ ...f, date: v }))} /></Field>
        <Field label="Od" hint={form.kind === 'visit' && selectedDoctor?.slot_duration_min ? `co ${effInterval} min (lekarz)` : `co ${effInterval} min`}>
          <TimePicker value={form.from} stepMin={effInterval} onChange={v => setForm(f => ({ ...f, from: v }))} />
        </Field>
        <Field label="Do" hint={`wygeneruje ${dayTimes.length} ${dayTimes.length === 1 ? 'termin' : 'terminów'}/dzień`}>
          <TimePicker value={form.to} stepMin={effInterval} onChange={v => setForm(f => ({ ...f, to: v }))} />
        </Field>
        <Field label="Forma">
          <Select value={form.modality} onChange={v => setForm(f => ({ ...f, modality: v }))}
            options={[
              { value: 'STATIONARY', label: 'stacjonarna (z opcją teleporady)' },
              { value: 'STATIONARY_ONLY', label: 'stacjonarna (tylko)' },
              { value: 'ONLINE', label: 'teleporada' },
            ]} />
        </Field>
        {!(form.kind === 'visit' && form.service_id) && (
          <Field label="Cena [zł]" hint="puste = NFZ">
            <input type="number" min="0" step="10" className={inputCls} value={form.price} placeholder="—" onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </Field>
        )}
        <Field label="Powtarzanie">
          <Select value={form.weeks} onChange={v => setForm(f => ({ ...f, weeks: v }))}
            options={[{ value: '1', label: 'jednorazowo' }, ...[2, 3, 4, 6, 8, 12].map(n => ({ value: String(n), label: `co tydzień ×${n}` }))]} />
        </Field>
      </div>
      {totalSlots > 400 && <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-bold text-amber-800">Za dużo terminów naraz ({totalSlots}) — zawęź zakres godzin albo powtarzanie (max 400).</p>}
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      {ok && <p className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-700">{ok}</p>}
    </Modal>
  )
}

// ---- modal: ustawienia placówki ----
function UstawieniaPlacowki({ clinic, onClose }: { clinic: { clinic_id: string; slot_interval_min: number; earlier_notice_min_hours: number; reminder_mode: 'NONE' | 'REMINDER' | 'CONFIRM'; confirmation_hours: number }; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [intervalMin, setIntervalMin] = useState(String(clinic.slot_interval_min))
  const [noticeHours, setNoticeHours] = useState(String(clinic.earlier_notice_min_hours))
  const [reminderMode, setReminderMode] = useState<string>(clinic.reminder_mode)
  const [confirmHours, setConfirmHours] = useState(String(clinic.confirmation_hours))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => api(`/clinics/${clinic.clinic_id}/settings`, {
      method: 'PATCH',
      body: { slot_interval_min: Number(intervalMin), earlier_notice_min_hours: Number(noticeHours), reminder_mode: reminderMode, confirmation_hours: Number(confirmHours) },
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clinics'] }); onClose() },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać ustawień.'),
  })

  // długość wizyt per lekarz (krok siatki danego lekarza) — zapis natychmiast po edycji
  const { data: docs } = useQuery({
    queryKey: ['clinic-doctors', clinic.clinic_id],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinic.clinic_id}/doctors`),
  })
  const setLen = useMutation({
    mutationFn: ({ id, val }: { id: string; val: number | null }) =>
      api(`/clinics/${clinic.clinic_id}/doctors/${id}/visit-length`, { method: 'PATCH', body: { slot_duration_min: val } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['clinic-doctors', clinic.clinic_id] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać długości wizyty.'),
  })

  return (
    <Modal title="Ustawienia placówki" wide onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Anuluj</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Zapisz</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Siatka terminów [min]" hint="co ile minut sloty">
          <Select value={intervalMin} onChange={setIntervalMin} options={[5, 10, 15, 20, 30, 60].map(n => ({ value: String(n), label: `${n} min` }))} />
        </Field>
        <Field label="Min. wyprzedzenie [h]" hint="powiadomienia o wcześniejszym terminie">
          <input type="number" min="0" max="720" className={inputCls} value={noticeHours} onChange={e => setNoticeHours(e.target.value)} />
        </Field>
        <Field label="Przypomnienia SMS o wizycie" hint="24 h przed terminem">
          <Select value={reminderMode} onChange={setReminderMode}
            options={[
              { value: 'NONE', label: 'brak' },
              { value: 'REMINDER', label: 'tylko przypomnienie' },
              { value: 'CONFIRM', label: 'przypomnienie + potwierdzenie' },
            ]} />
        </Field>
        {reminderMode === 'CONFIRM' && (
          <Field label="Prośba o potwierdzenie [h przed]">
            <Select value={confirmHours} onChange={setConfirmHours} options={[12, 24, 48, 72, 168].map(n => ({ value: String(n), label: `${n} h` }))} />
          </Field>
        )}
      </div>

      {docs && docs.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-extrabold text-gray-900">Długość wizyt per lekarz</p>
          <p className="mb-2 text-xs font-medium text-gray-500">
            Puste = siatka placówki ({intervalMin} min). Zmiana zapisuje się po wyjściu z pola.
          </p>
          <div className="space-y-1.5">
            {docs.map(d => (
              <div key={`${d.doctor_id}:${d.slot_duration_min ?? ''}`} className="flex items-center gap-3 rounded-xl bg-gray-50 px-3.5 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{d.name}</span>
                <input type="number" min="5" max="120" step="5" defaultValue={d.slot_duration_min ?? ''}
                  placeholder={String(intervalMin)} className={`${inputCls} w-24 text-center`}
                  onBlur={e => {
                    const v = e.target.value.trim()
                    const num = v === '' ? null : Number(v)
                    if (num !== d.slot_duration_min) setLen.mutate({ id: String(d.doctor_id), val: num })
                  }} />
                <span className="text-xs font-bold text-gray-500">min</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 border-t border-gray-100 pt-5">
        <ServicesManager clinicId={clinic.clinic_id} />
      </div>

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
    </Modal>
  )
}
