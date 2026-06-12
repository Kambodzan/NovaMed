import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, CalendarRange, Plus, X } from 'lucide-react'
import { Button, DateChip, EmptyState, Field, PageHeader, Tile, TileHeader, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { dayNo, formatTime, monthShort } from '../../lib/format'
import type { AppointmentOut } from '../../lib/types'
import { DatePicker } from '../../components/DatePicker'

interface Clinic {
  clinic_id: number; clinic_name: string; earlier_notice_min_hours: number; slot_interval_min: number
  confirmation_required: boolean; confirmation_hours: number
}
interface DoctorRow { doctor_id: number; name: string; specialization: string | null }

export function Terminy() {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const { data: clinics } = useQuery({
    queryKey: ['clinics'],
    queryFn: () => api<Clinic[]>('/clinics'),
  })
  // przychodnia = wiele placówek; rejestracja wybiera, którą obsługuje
  const [clinicId, setClinicId] = useState<number | null>(null)
  const clinic = (clinics ?? []).find(c => c.clinic_id === clinicId) ?? clinics?.[0]

  const { data: doctors } = useQuery({
    queryKey: ['clinic-doctors', clinic?.clinic_id],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinic!.clinic_id}/doctors`),
    enabled: !!clinic,
  })

  const { data: slots } = useQuery({
    queryKey: ['clinic-slots', clinic?.clinic_id],
    queryFn: () => api<AppointmentOut[]>(`/slots?clinic_id=${clinic!.clinic_id}`),
    enabled: !!clinic,
  })

  const [form, setForm] = useState({
    kind: 'visit',      // visit = wizyta lekarska, exam = badanie (pracownia)
    service: '',
    referral: false,
    doctor_id: '',
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: '09:00',
    type: 'STATIONARY',
    price: '',
    weeks: '1', // QW-5: 1 = jednorazowo, N = co tydzień przez N tygodni
  })
  const doctorId = form.doctor_id || String(doctors?.[0]?.doctor_id ?? '')

  const addSlot = useMutation({
    mutationFn: () => {
      const weeks = Math.max(1, Number(form.weeks) || 1)
      const base = new Date(`${form.date}T${form.time}:00`)
      // lokalna data bez przesunięcia strefy — składamy ręcznie, nie przez toISOString()
      const pad = (n: number) => String(n).padStart(2, '0')
      const datetimes = Array.from({ length: weeks }, (_, i) => {
        const d = new Date(base)
        d.setDate(d.getDate() + i * 7)
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${form.time}:00`
      })
      return api(`/clinics/${clinic!.clinic_id}/slots`, {
        method: 'POST',
        body: {
          doctor_id: form.kind === 'visit' ? Number(doctorId) : null,
          service_name: form.kind === 'exam' ? form.service.trim() : null,
          datetimes,
          appointment_type: form.type,
          price: form.price ? Number(form.price) : null,
        },
      })
    },
    onSuccess: () => {
      setError(null)
      const weeks = Math.max(1, Number(form.weeks) || 1)
      setOk(weeks > 1
        ? `Dodano ${weeks} terminów (co tydzień od ${form.date}, ${form.time}).`
        : `Dodano termin ${form.date} ${form.time}.`)
      void queryClient.invalidateQueries({ queryKey: ['clinic-slots'] })
    },
    onError: (e) => { setOk(null); setError(e instanceof ApiError ? e.message : 'Nie udało się dodać terminu.') },
  })

  const [noticeHours, setNoticeHours] = useState('')
  const [intervalMin, setIntervalMin] = useState('15')
  const [confirmRequired, setConfirmRequired] = useState(false)
  const [confirmHours, setConfirmHours] = useState('48')
  const [noticeSaved, setNoticeSaved] = useState(false)
  useEffect(() => {
    if (clinic) {
      setNoticeHours(String(clinic.earlier_notice_min_hours))
      setIntervalMin(String(clinic.slot_interval_min))
      setConfirmRequired(clinic.confirmation_required)
      setConfirmHours(String(clinic.confirmation_hours))
    }
  }, [clinic])

  const saveNotice = useMutation({
    mutationFn: () => api(`/clinics/${clinic!.clinic_id}/settings`, {
      method: 'PATCH',
      body: {
        earlier_notice_min_hours: Number(noticeHours), slot_interval_min: Number(intervalMin),
        confirmation_required: confirmRequired, confirmation_hours: Number(confirmHours),
      },
    }),
    onSuccess: () => {
      setError(null)
      setNoticeSaved(true)
      setTimeout(() => setNoticeSaved(false), 2500)
      void queryClient.invalidateQueries({ queryKey: ['clinics'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać ustawienia.'),
  })

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const removeSlot = useMutation({
    mutationFn: (id: number) => api(`/slots/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['clinic-slots'] }) },
    onError: (e) => { setOk(null); setError(e instanceof ApiError ? e.message : 'Nie udało się usunąć terminu.') },
  })

  const slotsByDoctor = useMemo(() => {
    const map = new Map<string, AppointmentOut[]>()
    for (const s of slots ?? []) {
      const list = map.get(s.doctor_name) ?? []
      list.push(s)
      map.set(s.doctor_name, list)
    }
    return [...map.entries()]
  }, [slots])

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Terminy wizyt"
          sub="Dodawanie wolnych terminów do kalendarzy lekarzy (UC-PP2)"
          action={(clinics ?? []).length > 1 && (
            <select
              aria-label="Placówka"
              className={cx(inputCls, 'w-56')}
              value={clinic?.clinic_id ?? ''}
              onChange={e => setClinicId(Number(e.target.value))}
            >
              {(clinics ?? []).map(c => <option key={c.clinic_id} value={c.clinic_id}>{c.clinic_name}</option>)}
            </select>
          )}
        />
      </div>

      <Tile delay={60}>
        <TileHeader title="Dodaj wolny termin" />
        <form
          className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto]"
          onSubmit={e => { e.preventDefault(); addSlot.mutate() }}
        >
          <Field label="Rodzaj">
            <select className={inputCls} value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
              <option value="visit">wizyta lekarska</option>
              <option value="exam">badanie (pracownia)</option>
            </select>
          </Field>
          {form.kind === 'visit' ? (
            <Field label="Lekarz">
              <select className={inputCls} value={doctorId} onChange={e => setForm(f => ({ ...f, doctor_id: e.target.value }))}>
                {(doctors ?? []).map(d => (
                  <option key={d.doctor_id} value={d.doctor_id}>{d.name} — {d.specialization}</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Badanie" hint="bez ceny = NFZ (wymagane skierowanie); z ceną = prywatne, bez skierowania">
              <input className={inputCls} required minLength={2} value={form.service} placeholder="np. RTG klatki piersiowej"
                onChange={e => setForm(f => ({ ...f, service: e.target.value }))} />
            </Field>
          )}
          <Field label="Data">
            <DatePicker required value={form.date} min={new Date().toISOString().slice(0, 10)}
              onChange={v => setForm(f => ({ ...f, date: v }))} />
          </Field>
          <Field label="Godzina" hint={`siatka co ${clinic?.slot_interval_min ?? 15} min`}>
            <input type="time" className={inputCls} required value={form.time}
              step={(clinic?.slot_interval_min ?? 15) * 60}
              onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
          </Field>
          <Field label="Forma">
            <select className={inputCls} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="STATIONARY">stacjonarna</option>
              <option value="ONLINE">teleporada</option>
            </select>
          </Field>
          <Field label="Cena [zł]" hint="puste = NFZ">
            <input type="number" min="0" step="10" className={inputCls} value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="—" />
          </Field>
          <Field label="Powtarzanie">
            <select className={inputCls} value={form.weeks} onChange={e => setForm(f => ({ ...f, weeks: e.target.value }))}>
              <option value="1">jednorazowo</option>
              {[2, 3, 4, 6, 8, 12].map(n => (
                <option key={n} value={n}>co tydzień ×{n}</option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <Button disabled={addSlot.isPending || !doctorId} type="submit"><Plus size={15} /> Dodaj</Button>
          </div>
        </form>
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
        {ok && <p className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-700">{ok}</p>}
      </Tile>

      <Tile className="p-5" delay={90}>
        <TileHeader title={<span className="inline-flex items-center gap-1.5"><BellRing size={13} /> Ustawienia placówki</span>} />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Siatka terminów [min]" hint="godziny slotów co 15/20/30 min">
            <select className={cx(inputCls, 'w-32')} value={intervalMin} onChange={e => setIntervalMin(e.target.value)}>
              {[5, 10, 15, 20, 30, 60].map(n => <option key={n} value={n}>{n} min</option>)}
            </select>
          </Field>
          <Field label="Min. wyprzedzenie [h]" hint="powiadomienia o wcześniejszym terminie">
            <input
              type="number" min="0" max="720" className={cx(inputCls, 'w-32')}
              value={noticeHours} onChange={e => setNoticeHours(e.target.value)}
            />
          </Field>
          <Field label="Potwierdzanie obecności" hint="pacjent potwierdza, że przyjdzie">
            <select
              className={cx(inputCls, 'w-44')}
              value={confirmRequired ? 'on' : 'off'}
              onChange={e => setConfirmRequired(e.target.value === 'on')}
            >
              <option value="off">tylko przypomnienia</option>
              <option value="on">wymagaj potwierdzenia</option>
            </select>
          </Field>
          {confirmRequired && (
            <Field label="Prośba o potwierdzenie" hint="ile godzin przed wizytą">
              <select className={cx(inputCls, 'w-32')} value={confirmHours} onChange={e => setConfirmHours(e.target.value)}>
                {[12, 24, 48, 72, 168].map(n => <option key={n} value={n}>{n} h</option>)}
              </select>
            </Field>
          )}
          <Button size="sm" disabled={saveNotice.isPending || noticeHours === ''} onClick={() => saveNotice.mutate()}>
            {saveNotice.isPending ? 'Zapisywanie…' : 'Zapisz'}
          </Button>
          {noticeSaved && <span className="pb-2 text-xs font-bold text-emerald-700">Zapisano</span>}
        </div>
        <p className="mt-2 text-xs font-medium text-gray-400">
          Pacjenci, którzy przy rezerwacji zaznaczyli „powiadom, jeśli zwolni się wcześniejszy termin",
          dostaną powiadomienie, gdy u ich lekarza pojawi się wolny termin wcześniejszy niż ich wizyta.
          {confirmRequired && ' Przy włączonym potwierdzaniu pacjent dostaje prośbę o potwierdzenie obecności, a brak potwierdzenia jest oznaczony w grafiku.'}
        </p>
      </Tile>

      <Tile className="p-5" delay={120}>
        <TileHeader title={`Wolne terminy (${slots?.length ?? 0})`} />
        {slotsByDoctor.length === 0 ? (
          <EmptyState
            icon={<CalendarRange size={28} strokeWidth={1.5} />}
            title="Brak wolnych terminów"
            hint="Dodaj terminy formularzem powyżej."
          />
        ) : (
          <div className="space-y-4">
            {slotsByDoctor.map(([doctor, list]) => {
              const shown = expanded[doctor] ? list : list.slice(0, 8)
              return (
                <div key={doctor}>
                  <p className="mb-2 text-sm font-extrabold text-gray-900">{doctor} <span className="font-semibold text-gray-400">· {list.length} terminów</span></p>
                  <ul className="flex flex-wrap gap-2">
                    {shown.map(s => (
                      <li key={s.appointment_id} className="group flex items-center gap-2 rounded-2xl bg-gray-50 p-2 pr-2">
                        <DateChip month={monthShort(s.appointment_datetime)} day={dayNo(s.appointment_datetime)} />
                        <span className="text-xs font-bold text-gray-600 [font-variant-numeric:tabular-nums]">
                          {formatTime(s.appointment_datetime)}
                          <span className={cx('ml-1 font-semibold', s.appointment_type === 'ONLINE' ? 'text-sky-600' : 'text-gray-400')}>
                            {s.appointment_type === 'ONLINE' ? 'online' : 'stacj.'}
                          </span>
                          <span className={cx('ml-1', s.price ? 'text-gray-900' : 'text-emerald-700')}>
                            {s.price ? `${s.price} zł` : 'NFZ'}
                          </span>
                        </span>
                        <button
                          aria-label="Usuń wolny termin"
                          title="Usuń wolny termin"
                          disabled={removeSlot.isPending}
                          onClick={() => removeSlot.mutate(s.appointment_id)}
                          className="cursor-pointer rounded-full p-1 text-gray-300 hover:bg-gray-100 hover:text-red-600"
                        >
                          <X size={13} />
                        </button>
                      </li>
                    ))}
                    {list.length > 8 && (
                      <li className="self-center">
                        <button
                          onClick={() => setExpanded(e => ({ ...e, [doctor]: !e[doctor] }))}
                          className="cursor-pointer text-xs font-extrabold text-primary hover:underline"
                        >
                          {expanded[doctor] ? 'Zwiń' : `Pokaż wszystkie (+${list.length - 8})`}
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </Tile>
    </div>
  )
}
