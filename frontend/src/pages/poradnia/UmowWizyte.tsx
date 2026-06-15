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
import type { AppointmentOut, DocumentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { DatePicker } from '../../components/DatePicker'
import { Select } from '../../components/Select'

interface PatientRow { patient_id: string; first_name: string; last_name: string; pesel: string; insurance_status: boolean }
interface DoctorRow { doctor_id: string; name: string; specializations: string[] }
interface PickedPatient { patient_id: string; name: string; pesel: string; isNew?: boolean }

const NEW_PATIENT = { first_name: '', last_name: '', pesel: '', birth_date: '', phone_number: '', email: '' }
// szukanie bez wrażliwości na polskie znaki ("kardio" ↔ "Kardiolog", "zielinski" ↔ "Zieliński")
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

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

  // krok 2: termin — wyszukiwarka tekstowa (lekarz/specjalizacja) + filtr dnia
  const [query, setQuery] = useState('')
  const [dayFilter, setDayFilter] = useState('')
  // wejście z „Grafiku dnia" (klik „Umów" przy wolnym slocie) — preselekcja
  const navState = useLocation().state as { doctorId?: string | null; day?: string } | null
  useEffect(() => {
    if (navState?.day) setDayFilter(navState.day)
  }, [navState?.day])
  const [slot, setSlot] = useState<AppointmentOut | null>(null)
  const [reason, setReason] = useState('')
  const [referralChoice, setReferralChoice] = useState('')  // '' | 'external' | <document_id>

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
  // preselekcja lekarza z „Grafiku dnia": wpisz jego nazwisko do wyszukiwarki
  useEffect(() => {
    if (navState?.doctorId && doctors) {
      const d = doctors.find(x => x.doctor_id === navState.doctorId)
      if (d) setQuery(d.name)
    }
  }, [navState?.doctorId, doctors])
  const { data: slots } = useQuery({
    queryKey: ['clinic-slots', clinic?.clinic_id],
    queryFn: () => api<AppointmentOut[]>(`/slots?clinic_id=${clinic!.clinic_id}`),
    enabled: !!clinic,
  })
  // e-skierowania pacjenta (do badania NFZ wymagającego skierowania)
  const needsReferral = !!slot?.referral_required
  const { data: patientDocs } = useQuery({
    queryKey: ['patient-docs', picked?.patient_id],
    queryFn: () => api<DocumentOut[]>(`/patients/${picked!.patient_id}/documents`),
    enabled: !!picked && needsReferral,
  })
  const referrals = (patientDocs ?? []).filter(
    d => d.document_type === 'REFERRAL' && !['REVOKED', 'REALIZED'].includes(d.document_status))

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return [] as PatientRow[]
    return (patients ?? [])
      .filter(p => `${p.first_name} ${p.last_name} ${p.pesel}`.toLowerCase().includes(needle))
      .slice(0, 6)
  }, [patients, q])

  const freeSlots = useMemo(() => {
    const needle = fold(query.trim())
    return (slots ?? [])
      .filter(s => !needle || fold(`${s.doctor_name} ${s.service_name ?? ''} ${s.specializations.join(' ')}`).includes(needle))
      .filter(s => !dayFilter || s.appointment_datetime.slice(0, 10) === dayFilter)
      .sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))
  }, [slots, query, dayFilter])

  // grupowanie po dniu — czytelniejsze niż płaska lista z powtórzoną datą
  const slotsByDay = useMemo(() => {
    const m = new Map<string, AppointmentOut[]>()
    for (const s of freeSlots) {
      const day = s.appointment_datetime.slice(0, 10)
      m.set(day, [...(m.get(day) ?? []), s])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [freeSlots])

  const reset = () => {
    setPicked(null); setNewForm(NEW_PATIENT); setQ(''); setMode('existing')
    setSlot(null); setReason(''); setReferralChoice('')
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
      body: {
        patient_id: picked!.patient_id, reason: reason.trim() || undefined,
        external_referral: needsReferral && referralChoice === 'external',
        referral_document_id: needsReferral && referralChoice && referralChoice !== 'external' ? referralChoice : undefined,
      },
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
  const referralBlocked = needsReferral && !referralChoice
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
            <div className="relative min-w-[13rem] flex-1">
              <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400" />
              <input className={cx(inputCls, 'w-full pl-10 pr-8')} placeholder="Szukaj: lekarz lub specjalizacja…"
                value={query} onChange={e => setQuery(e.target.value)} />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Wyczyść"
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-700">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="w-40"><DatePicker value={dayFilter} placeholder="dowolny dzień" onChange={setDayFilter} /></div>
            {dayFilter && <button onClick={() => setDayFilter('')} className="cursor-pointer text-xs font-extrabold text-gray-400 hover:text-gray-700">wyczyść</button>}
          </div>

          {freeSlots.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm font-medium text-gray-400">
              {query || dayFilter ? 'Brak wolnych terminów dla tego filtra.' : 'Brak wolnych terminów. Dodaj je w zakładce „Terminy".'}
            </p>
          ) : (
            <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
              {slotsByDay.map(([day, list]) => (
                <div key={day}>
                  <p className="sticky top-0 z-10 bg-surface/95 py-1 text-xs font-extrabold tracking-wide text-gray-500 backdrop-blur">
                    {formatDatePL(day + 'T00:00:00')} <span className="font-bold text-gray-400">· {list.length}</span>
                  </p>
                  <ul className="space-y-1.5">
                    {list.map(s => {
                      const sel = slot?.appointment_id === s.appointment_id
                      const online = s.appointment_type === 'ONLINE'
                      return (
                        <li key={s.appointment_id}>
                          <button onClick={() => setSlot(sel ? null : s)}
                            className={cx('flex w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-colors',
                              sel ? 'bg-primary-soft ring-2 ring-primary' : 'bg-gray-50 hover:bg-gray-100')}>
                            <span className="shrink-0 text-base font-extrabold text-gray-900 [font-variant-numeric:tabular-nums]">
                              {formatTime(s.appointment_datetime)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-gray-900">
                                {s.doctor_id ? s.doctor_name : s.service_name}
                              </span>
                              <span className="flex items-center gap-1 truncate text-xs font-medium text-gray-500">
                                {online ? <><Video size={12} className="shrink-0" /> teleporada</> : <><MapPin size={12} className="shrink-0" /> stacjonarna</>}
                                {s.specializations.length ? ` · ${s.specializations.join(' · ')}` : ''}
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
                </div>
              ))}
            </div>
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
          {needsReferral && (
            <div className="min-w-[14rem]">
              <Field label="Skierowanie" hint="badanie NFZ wymaga skierowania">
                <Select value={referralChoice} onChange={setReferralChoice}
                  placeholder="Wybierz skierowanie…"
                  options={[
                    ...referrals.map(r => ({ value: r.document_id, label: `e-skierowanie${r.code ? ` ${r.code}` : ''}`, hint: r.details ?? undefined })),
                    { value: 'external', label: 'Skierowanie zewnętrzne (papierowe)' },
                  ]} />
              </Field>
            </div>
          )}
          <Button size="lg" disabled={!canBook || book.isPending} onClick={() => book.mutate()}>
            <CalendarCheck size={17} /> {book.isPending ? 'Umawianie…' : 'Umów wizytę'}
          </Button>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-gray-400">
          <Phone size={12} />
          {!picked ? 'Wybierz pacjenta.' : !slot ? 'Wybierz wolny termin.'
            : referralBlocked ? 'To badanie wymaga skierowania — wskaż e-skierowanie z systemu albo zewnętrzne.'
            : `Wizyta zostanie potwierdzona od razu, pacjent dostanie SMS. ${slot.price ? `Opłata ${slot.price} zł — rozliczana na miejscu.` : ''}`}
        </p>
      </Tile>
    </div>
  )
}
