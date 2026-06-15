// Rejestracja umawia pacjenta dzwoniącego na recepcję (UC-PP1):
// 1) wybór pacjenta — istniejący (po nazwisku/PESEL) albo nowy dzwoniący,
// 2) wybór wolnego terminu (filtr lekarza), 3) rezerwacja → CONFIRMED + SMS.
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Check, MapPin, Phone, Search, UserPlus, Video, X } from 'lucide-react'
import { Badge, Button, Field, PageHeader, Tile, TileHeader, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { AppointmentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { DatePicker } from '../../components/DatePicker'
import { Select } from '../../components/Select'

interface PatientRow { patient_id: string; first_name: string; last_name: string; pesel: string; insurance_status: boolean }
interface DoctorRow { doctor_id: string; name: string; specialization: string | null }
interface PickedPatient { patient_id: string; name: string; pesel: string; isNew?: boolean }

const NEW_PATIENT = { first_name: '', last_name: '', pesel: '', birth_date: '', phone_number: '', email: '' }

export function UmowWizyte() {
  const queryClient = useQueryClient()
  const { clinics, clinic, setClinicId } = useClinicSelection()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // krok 1: pacjent
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<PickedPatient | null>(null)
  const [newForm, setNewForm] = useState(NEW_PATIENT)

  // krok 2: termin
  const [doctorFilter, setDoctorFilter] = useState('')
  const [dayFilter, setDayFilter] = useState('')
  // wejście z „Grafiku dnia" (klik „Umów" przy wolnym slocie) — preselekcja
  const navState = useLocation().state as { doctorId?: string | null; day?: string } | null
  useEffect(() => {
    if (navState?.doctorId) setDoctorFilter(navState.doctorId)
    if (navState?.day) setDayFilter(navState.day)
  }, [navState?.doctorId, navState?.day])
  const [slot, setSlot] = useState<AppointmentOut | null>(null)
  const [reason, setReason] = useState('')
  const [hasReferral, setHasReferral] = useState(false)

  const { data: patients } = useQuery({
    queryKey: ['clinic-patients', clinic?.clinic_id],
    queryFn: () => api<PatientRow[]>(`/clinics/${clinic!.clinic_id}/patients`),
    enabled: !!clinic,
  })
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

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return [] as PatientRow[]
    return (patients ?? [])
      .filter(p => `${p.first_name} ${p.last_name} ${p.pesel}`.toLowerCase().includes(needle))
      .slice(0, 6)
  }, [patients, q])

  const freeSlots = useMemo(() => {
    return (slots ?? [])
      .filter(s => !doctorFilter || s.doctor_id === doctorFilter)
      .filter(s => !dayFilter || s.appointment_datetime.slice(0, 10) === dayFilter)
      .sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))
  }, [slots, doctorFilter, dayFilter])

  const reset = () => {
    setPicked(null); setNewForm(NEW_PATIENT); setQ(''); setMode('existing')
    setSlot(null); setReason(''); setHasReferral(false)
  }

  const register = useMutation({
    mutationFn: () => api<PickedPatient & { existing: boolean; first_name: string; last_name: string }>(
      '/patients/register', {
        method: 'POST',
        body: {
          first_name: newForm.first_name.trim(), last_name: newForm.last_name.trim(),
          pesel: newForm.pesel.trim(), birth_date: newForm.birth_date,
          phone_number: newForm.phone_number.trim(),
          email: newForm.email.trim() || undefined,
        },
      }),
    onSuccess: (r) => {
      setError(null)
      setPicked({ patient_id: r.patient_id, name: `${r.first_name} ${r.last_name}`, pesel: r.pesel, isNew: !r.existing })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zarejestrować pacjenta.'),
  })

  const book = useMutation({
    mutationFn: () => api<AppointmentOut>(`/appointments/${slot!.appointment_id}/book-for`, {
      method: 'POST',
      body: { patient_id: picked!.patient_id, reason: reason.trim() || undefined, external_referral: hasReferral },
    }),
    onSuccess: (a) => {
      setError(null)
      setDone(`Umówiono: ${picked!.name} — ${formatDatePL(a.appointment_datetime)}, ${formatTime(a.appointment_datetime)} (${a.doctor_name}).`)
      void queryClient.invalidateQueries({ queryKey: ['clinic-slots'] })
      reset()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się umówić wizyty.'),
  })

  const newValid = newForm.first_name.trim() && newForm.last_name.trim()
    && /^\d{11}$/.test(newForm.pesel.trim()) && newForm.birth_date && newForm.phone_number.trim().length >= 7
  const referralBlocked = !!slot?.referral_required && !hasReferral
  const canBook = picked && slot && !referralBlocked

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Umów wizytę"
          sub="Rezerwacja w imieniu pacjenta zgłaszającego się telefonicznie lub w okienku (UC-PP1)"
          action={<ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />}
        />
      </div>

      {done && (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-700 fade-up">
          <Check size={15} /> {done}
        </p>
      )}
      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* KROK 1 — pacjent */}
        <Tile className="p-5" delay={60}>
          <TileHeader title="1. Pacjent" action={picked && (
            <button onClick={reset} className="inline-flex cursor-pointer items-center gap-1 text-xs font-extrabold text-gray-400 hover:text-red-600">
              <X size={13} /> zmień
            </button>
          )} />

          {picked ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-primary-soft/40 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold text-gray-900">{picked.name}</p>
                <p className="text-xs font-medium text-gray-500">PESEL {picked.pesel}</p>
              </div>
              {picked.isNew
                ? <Badge tone="success"><UserPlus size={12} /> nowe konto</Badge>
                : <Badge tone="info">w systemie</Badge>}
            </div>
          ) : (
            <>
              <div className="mb-3 flex gap-1.5" role="tablist">
                {(['existing', 'new'] as const).map(m => (
                  <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                    className={cx('cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-extrabold transition-colors',
                      mode === m ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                    {m === 'existing' ? 'Pacjent w systemie' : 'Nowy pacjent'}
                  </button>
                ))}
              </div>

              {mode === 'existing' ? (
                <>
                  <div className="relative">
                    <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400" />
                    <input className={cx(inputCls, 'w-full pl-10')} autoFocus placeholder="Nazwisko lub PESEL…"
                      value={q} onChange={e => setQ(e.target.value)} />
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {q.trim() && matches.length === 0 && (
                      <li className="rounded-xl bg-gray-50 px-4 py-3 text-sm font-medium text-gray-400">
                        Brak pacjenta w tej placówce. Jeśli dzwoni nowy pacjent — użyj „Nowy pacjent".
                      </li>
                    )}
                    {matches.map(p => (
                      <li key={p.patient_id}>
                        <button onClick={() => setPicked({ patient_id: p.patient_id, name: `${p.first_name} ${p.last_name}`, pesel: p.pesel })}
                          className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-2.5 text-left hover:bg-gray-100">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-extrabold text-gray-900">{p.first_name} {p.last_name}</span>
                            <span className="block text-xs font-medium text-gray-500">PESEL {p.pesel}</span>
                          </span>
                          <span className="shrink-0 text-xs font-extrabold text-primary">wybierz</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Imię"><input className={inputCls} value={newForm.first_name} onChange={e => setNewForm(f => ({ ...f, first_name: e.target.value }))} /></Field>
                  <Field label="Nazwisko"><input className={inputCls} value={newForm.last_name} onChange={e => setNewForm(f => ({ ...f, last_name: e.target.value }))} /></Field>
                  <Field label="PESEL" hint="11 cyfr">
                    <input className={inputCls} inputMode="numeric" maxLength={11} value={newForm.pesel}
                      onChange={e => setNewForm(f => ({ ...f, pesel: e.target.value.replace(/\D/g, '') }))} />
                  </Field>
                  <Field label="Data urodzenia">
                    <DatePicker value={newForm.birth_date} max={new Date().toISOString().slice(0, 10)}
                      onChange={v => setNewForm(f => ({ ...f, birth_date: v }))} />
                  </Field>
                  <Field label="Telefon" hint="na SMS-y z przypomnieniem">
                    <input className={inputCls} value={newForm.phone_number} placeholder="601 234 567"
                      onChange={e => setNewForm(f => ({ ...f, phone_number: e.target.value }))} />
                  </Field>
                  <Field label="E-mail (opcjonalnie)" hint="do przejęcia konta przy rejestracji">
                    <input className={inputCls} type="email" value={newForm.email}
                      onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Button disabled={!newValid || register.isPending} onClick={() => register.mutate()}>
                      <UserPlus size={15} /> {register.isPending ? 'Zakładanie…' : 'Załóż i wybierz'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Tile>

        {/* KROK 2 — termin */}
        <Tile className="p-5" delay={90}>
          <TileHeader title="2. Wolny termin" action={
            <span className="text-xs font-bold text-gray-400">{freeSlots.length} dostępnych</span>
          } />
          <div className="mb-3 flex flex-wrap gap-2">
            <Select
              ariaLabel="Lekarz" className="min-w-[13rem] flex-1"
              value={doctorFilter} onChange={setDoctorFilter}
              options={[{ value: '', label: 'Wszyscy lekarze' },
                ...(doctors ?? []).map(d => ({ value: d.doctor_id, label: d.name, hint: d.specialization ?? undefined }))]}
            />
            <div className="w-40"><DatePicker value={dayFilter} placeholder="dowolny dzień" onChange={setDayFilter} /></div>
            {dayFilter && <button onClick={() => setDayFilter('')} className="cursor-pointer text-xs font-extrabold text-gray-400 hover:text-gray-700">wyczyść</button>}
          </div>

          {freeSlots.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm font-medium text-gray-400">
              Brak wolnych terminów dla wybranego filtra. Dodaj je w zakładce „Terminy".
            </p>
          ) : (
            <ul className="max-h-[44vh] space-y-1.5 overflow-y-auto pr-1">
              {freeSlots.map(s => {
                const sel = slot?.appointment_id === s.appointment_id
                return (
                  <li key={s.appointment_id}>
                    <button onClick={() => setSlot(sel ? null : s)}
                      className={cx('flex w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-colors',
                        sel ? 'bg-primary-soft ring-2 ring-primary' : 'bg-gray-50 hover:bg-gray-100')}>
                      <span className="text-gray-400">{s.appointment_type === 'ONLINE' ? <Video size={15} /> : <MapPin size={15} />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-extrabold text-gray-900 [font-variant-numeric:tabular-nums]">
                          {formatDatePL(s.appointment_datetime)}, {formatTime(s.appointment_datetime)}
                        </span>
                        <span className="block truncate text-xs font-medium text-gray-500">
                          {s.doctor_id ? s.doctor_name : s.service_name}
                          {s.specialization ? ` · ${s.specialization}` : ''}
                        </span>
                      </span>
                      <span className={cx('shrink-0 text-xs font-extrabold', s.price ? 'text-gray-900' : 'text-emerald-700')}>
                        {s.price ? `${s.price} zł` : 'NFZ'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Tile>
      </div>

      {/* KROK 3 — potwierdzenie */}
      <Tile className="p-5" delay={120}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[12rem] flex-1">
            <Field label="Powód wizyty (opcjonalnie)" hint="trafi do lekarza w grafiku">
              <input className={inputCls} value={reason} placeholder="np. kontrola, ból gardła…"
                onChange={e => setReason(e.target.value)} />
            </Field>
          </div>
          {slot?.referral_required && (
            <label className="flex items-center gap-2 pb-2.5 text-sm font-bold text-gray-700">
              <input type="checkbox" checked={hasReferral} onChange={e => setHasReferral(e.target.checked)} className="h-4 w-4" />
              Pacjent ma skierowanie
            </label>
          )}
          <Button size="lg" disabled={!canBook || book.isPending} onClick={() => book.mutate()}>
            <CalendarCheck size={17} /> {book.isPending ? 'Umawianie…' : 'Umów wizytę'}
          </Button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-gray-400">
          <Phone size={12} />
          {!picked ? 'Wybierz pacjenta.' : !slot ? 'Wybierz wolny termin.'
            : referralBlocked ? 'To badanie wymaga skierowania — zaznacz „Pacjent ma skierowanie".'
            : `Wizyta zostanie potwierdzona od razu, pacjent dostanie SMS. ${slot.price ? `Opłata ${slot.price} zł — rozliczana na miejscu.` : ''}`}
        </p>
      </Tile>
    </div>
  )
}
