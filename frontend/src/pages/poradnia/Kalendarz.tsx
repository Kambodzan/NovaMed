// Kalendarz lekarzy (UC-PP2) — serce rejestracji: czytelny grid „kto ma co o
// której" (godziny × lekarze) na wybrany dzień. Klik komórki: wolny → umów/usuń,
// zajęty → kartoteka/odwołaj. Zarządzanie terminami i ustawienia placówki scalone
// w modalach (dawne „Terminy").
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, ChevronLeft, ChevronRight, Plus, Search, Settings2, Video, X } from 'lucide-react'
import { Button, EmptyState, Field, Loading, Modal, PageHeader, StatusBadge, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import { confirm } from '../../lib/confirm'
import type { AppointmentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { DatePicker } from '../../components/DatePicker'
import { Select } from '../../components/Select'

const DAY_KEY = 'novamed-kalendarz-day'
// data LOKALNA (toISOString daje UTC → strzałki ‹›/„Dziś" skakały o ±dzień)
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => isoLocal(new Date())
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const hm = (iso: string) => iso.slice(11, 16)
const FINISHED = ['COMPLETED', 'NO_SHOW', 'INTERRUPTED']
interface DoctorRow { doctor_id: string; name: string; specializations: string[] }

export function Kalendarz() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
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
  const cell = (time: string, key: string) => visible.find(a => hm(a.appointment_datetime) === time && (a.doctor_id ?? '__exam') === key)

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
                <button onClick={() => shiftDay(-1)} aria-label="Poprzedni dzień" className="cursor-pointer rounded-full p-1.5 text-gray-400 hover:bg-gray-100"><ChevronLeft size={16} /></button>
                <DatePicker className="w-40" value={day} onChange={setDay} />
                <button onClick={() => shiftDay(1)} aria-label="Następny dzień" className="cursor-pointer rounded-full p-1.5 text-gray-400 hover:bg-gray-100"><ChevronRight size={16} /></button>
                {day !== todayIso() && <Button variant="ghost" size="sm" onClick={() => setDay(todayIso())}>Dziś</Button>}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setModal('add')}><Plus size={14} /> Dodaj terminy</Button>
              <Button variant="ghost" size="sm" onClick={() => setModal('settings')}><Settings2 size={14} /></Button>
            </div>
          }
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      {/* filtr lekarza/specjalizacji */}
      {(items?.length ?? 0) > 0 && (
        <div className="relative max-w-md fade-up">
          <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400" />
          <input className={cx(inputCls, 'w-full pl-10 pr-8')} placeholder="Filtruj: lekarz lub specjalizacja…"
            value={q} onChange={e => setQ(e.target.value)} />
          {q && <button onClick={() => setQ('')} className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-700"><X size={14} /></button>}
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
          <div className="min-w-fit">
            {/* nagłówek z lekarzami + najbliższy wolny termin */}
            <div className="sticky top-0 z-10 flex border-b border-gray-100 bg-surface/95 backdrop-blur">
              <div className="w-16 shrink-0" />
              {columns.map(c => {
                const nf = nextFree.get(c.key)
                return (
                  <div key={c.key} className="w-44 shrink-0 px-3 py-2.5">
                    <p className="truncate text-sm font-extrabold text-gray-900">{c.label}</p>
                    {c.specs.length > 0 && <p className="truncate text-[11px] font-semibold text-gray-400">{c.specs.join(' · ')}</p>}
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
                <div className="w-16 shrink-0 px-3 py-2 text-xs font-extrabold text-gray-400 [font-variant-numeric:tabular-nums]">{t}</div>
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
                          isFree ? 'border border-dashed border-gray-200 text-gray-400 hover:border-primary hover:text-primary'
                            : live ? 'bg-primary-soft ring-1 ring-primary'
                            : paused ? 'bg-amber-50 ring-1 ring-amber-200'
                            : done ? 'bg-gray-50 opacity-60' : 'bg-gray-50 hover:bg-gray-100')}>
                        {a.appointment_type === 'ONLINE' && <Video size={11} className="shrink-0 opacity-60" />}
                        {isFree ? (
                          <span className="flex items-center gap-1 text-xs font-bold"><Plus size={12} /> {a.price ? `${a.price} zł` : 'wolny'}</span>
                        ) : (
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-bold text-gray-900">{a.patient_name ?? a.service_name}</span>
                            {a.appointment_status === 'CONFIRMED' && a.confirmation_requested && !a.patient_confirmed && (
                              <span className="block text-[10px] font-bold text-amber-600">bez potw.</span>
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

// ---- modal: dodawanie terminów (dawne „Terminy") ----
function DodajTerminy({ clinicId, defaultDay, interval, onClose, onAdded }: {
  clinicId: string; defaultDay: string; interval: number; onClose: () => void; onAdded: () => void
}) {
  const [form, setForm] = useState({
    kind: 'visit', service: '', doctor_id: '', date: defaultDay, time: '09:00',
    modality: 'STATIONARY', price: '', weeks: '1',
  })
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const { data: doctors } = useQuery({
    queryKey: ['clinic-doctors', clinicId],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinicId}/doctors`),
  })
  const doctorId = form.doctor_id || String(doctors?.[0]?.doctor_id ?? '')

  const add = useMutation({
    mutationFn: () => {
      const weeks = Math.max(1, Number(form.weeks) || 1)
      const base = new Date(`${form.date}T${form.time}:00`)
      const pad = (n: number) => String(n).padStart(2, '0')
      const datetimes = Array.from({ length: weeks }, (_, i) => {
        const d = new Date(base); d.setDate(d.getDate() + i * 7)
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${form.time}:00`
      })
      return api(`/clinics/${clinicId}/slots`, {
        method: 'POST',
        body: {
          doctor_id: form.kind === 'visit' ? doctorId : null,
          service_name: form.kind === 'exam' ? form.service.trim() : null,
          datetimes,
          appointment_type: form.modality === 'ONLINE' ? 'ONLINE' : 'STATIONARY',
          allow_online: form.modality !== 'STATIONARY_ONLY',
          price: form.price ? Number(form.price) : null,
        },
      })
    },
    onSuccess: () => {
      const weeks = Math.max(1, Number(form.weeks) || 1)
      setError(null)
      setOk(weeks > 1 ? `Dodano ${weeks} terminów (co tydzień od ${form.date}).` : `Dodano termin ${form.date} ${form.time}.`)
      onAdded()
    },
    onError: (e) => { setOk(null); setError(e instanceof ApiError ? e.message : 'Nie udało się dodać terminu.') },
  })

  return (
    <Modal title="Dodaj terminy" overline="nowe wolne sloty w kalendarzu lekarza / pracowni" onClose={onClose} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Zamknij</Button>
        <Button disabled={add.isPending || (form.kind === 'visit' && !doctorId)} onClick={() => add.mutate()}><Plus size={15} /> Dodaj</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rodzaj">
          <Select value={form.kind} onChange={v => setForm(f => ({ ...f, kind: v }))}
            options={[{ value: 'visit', label: 'wizyta lekarska' }, { value: 'exam', label: 'badanie (pracownia)' }]} />
        </Field>
        {form.kind === 'visit' ? (
          <Field label="Lekarz">
            <Select value={doctorId} onChange={v => setForm(f => ({ ...f, doctor_id: v }))}
              options={(doctors ?? []).map(d => ({ value: String(d.doctor_id), label: d.name, hint: d.specializations.join(' · ') || undefined }))} />
          </Field>
        ) : (
          <Field label="Badanie" hint="bez ceny = NFZ (wymaga skierowania); z ceną = prywatne">
            <input className={inputCls} minLength={2} value={form.service} placeholder="np. RTG klatki piersiowej"
              onChange={e => setForm(f => ({ ...f, service: e.target.value }))} />
          </Field>
        )}
        <Field label="Data"><DatePicker value={form.date} min={new Date().toISOString().slice(0, 10)} onChange={v => setForm(f => ({ ...f, date: v }))} /></Field>
        <Field label="Godzina" hint={`siatka co ${interval} min`}>
          <input type="time" className={inputCls} value={form.time} step={interval * 60} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
        </Field>
        <Field label="Forma">
          <Select value={form.modality} onChange={v => setForm(f => ({ ...f, modality: v }))}
            options={[
              { value: 'STATIONARY', label: 'stacjonarna (z opcją teleporady)' },
              { value: 'STATIONARY_ONLY', label: 'stacjonarna (tylko)' },
              { value: 'ONLINE', label: 'teleporada' },
            ]} />
        </Field>
        <Field label="Cena [zł]" hint="puste = NFZ">
          <input type="number" min="0" step="10" className={inputCls} value={form.price} placeholder="—" onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
        </Field>
        <Field label="Powtarzanie">
          <Select value={form.weeks} onChange={v => setForm(f => ({ ...f, weeks: v }))}
            options={[{ value: '1', label: 'jednorazowo' }, ...[2, 3, 4, 6, 8, 12].map(n => ({ value: String(n), label: `co tydzień ×${n}` }))]} />
        </Field>
      </div>
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      {ok && <p className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-700">{ok}</p>}
    </Modal>
  )
}

// ---- modal: ustawienia placówki ----
function UstawieniaPlacowki({ clinic, onClose }: { clinic: { clinic_id: string; slot_interval_min: number; earlier_notice_min_hours: number; confirmation_required: boolean; confirmation_hours: number }; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [intervalMin, setIntervalMin] = useState(String(clinic.slot_interval_min))
  const [noticeHours, setNoticeHours] = useState(String(clinic.earlier_notice_min_hours))
  const [confirmRequired, setConfirmRequired] = useState(clinic.confirmation_required)
  const [confirmHours, setConfirmHours] = useState(String(clinic.confirmation_hours))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => api(`/clinics/${clinic.clinic_id}/settings`, {
      method: 'PATCH',
      body: { slot_interval_min: Number(intervalMin), earlier_notice_min_hours: Number(noticeHours), confirmation_required: confirmRequired, confirmation_hours: Number(confirmHours) },
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clinics'] }); onClose() },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać ustawień.'),
  })

  return (
    <Modal title="Ustawienia placówki" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Anuluj</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>Zapisz</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Siatka terminów [min]" hint="co ile minut sloty">
          <Select value={intervalMin} onChange={setIntervalMin} options={[5, 10, 15, 20, 30, 60].map(n => ({ value: String(n), label: `${n} min` }))} />
        </Field>
        <Field label="Min. wyprzedzenie [h]" hint="powiadomienia o wcześniejszym terminie">
          <input type="number" min="0" max="720" className={inputCls} value={noticeHours} onChange={e => setNoticeHours(e.target.value)} />
        </Field>
        <Field label="Potwierdzanie obecności">
          <Select value={confirmRequired ? 'yes' : 'no'} onChange={v => setConfirmRequired(v === 'yes')}
            options={[{ value: 'no', label: 'wyłączone' }, { value: 'yes', label: 'wymagane' }]} />
        </Field>
        {confirmRequired && (
          <Field label="Prośba o potwierdzenie [h przed]">
            <Select value={confirmHours} onChange={setConfirmHours} options={[12, 24, 48, 72, 168].map(n => ({ value: String(n), label: `${n} h` }))} />
          </Field>
        )}
      </div>
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
    </Modal>
  )
}
