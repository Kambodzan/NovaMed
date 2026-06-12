import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellPlus, Check, ChevronDown, ChevronLeft, ChevronRight, CreditCard, Trash2, CalendarDays, X, XCircle } from 'lucide-react'
import { Typeahead, type TypeaheadItem } from '../components/Typeahead'
import { Avatar, Button, DateChip, EmptyState, Field, Modal, Tile, TileHeader, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { dayNo, formatDatePL, formatTime, monthShort } from '../lib/format'
import type { AppointmentOut, BookOut, WaitlistEntry } from '../lib/types'

type PayPhase = 'idle' | 'awaiting' | 'success' | 'declined'

// wyszukiwanie bez wrażliwości na polskie znaki ("kardio" ↔ "Kardiolog", "zielinski" ↔ "Zieliński")
const fold = (s: string) => s.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replaceAll('ł', 'l')

const doctorInitials = (name: string) => {
  const parts = name.replace(/^(dr|lek\.|piel\.)\s+/i, '').split(' ')
  return parts.map(p => p[0]).slice(0, 2).join('').toUpperCase()
}

const shortLoc = (clinicName: string) => clinicName.split('—').pop()!.trim()

interface DoctorCardData {
  id: number
  name: string
  spec: string | null
  clinics: string[]
  days: ReadonlyArray<readonly [string, AppointmentOut[]]>
}

// Karta lekarza: zwinięta = ściąga z najbliższym terminem; klik rozwija
// mini-kalendarz (3 dni, strzałki ‹ ›, godziny jako punkty).
function DoctorCard({ d, multiClinic, onPick }: {
  d: DoctorCardData
  multiClinic: boolean
  onPick: (s: AppointmentOut) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const visible = d.days.slice(offset, offset + 3)
  const nearest = d.days[0][1][0]
  const dayLabel = (day: string) =>
    `${formatDatePL(day + 'T00:00:00').split(',')[0]} ${dayNo(day + 'T00:00:00')} ${monthShort(day + 'T00:00:00')}`

  return (
    <div className="rounded-2xl bg-gray-50">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 p-4 text-left"
      >
        <Avatar initials={doctorInitials(d.name)} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-gray-900">{d.name}</span>
          <span className="block truncate text-xs font-semibold text-gray-500">
            {d.spec}{multiClinic && <> · {d.clinics.map(shortLoc).join(', ')}</>}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[10px] font-extrabold tracking-wider text-gray-400 uppercase">{t('najbliższy')}</span>
          <span className="block text-sm font-extrabold text-primary [font-variant-numeric:tabular-nums]">
            {dayLabel(nearest.appointment_datetime.slice(0, 10))}, {formatTime(nearest.appointment_datetime)}
          </span>
        </span>
        <ChevronDown size={16} className={cx('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-gray-200/70 p-4 pt-3">
          <div className="mb-2 flex justify-end gap-1">
            <button aria-label={t('Wcześniejsze dni')} disabled={offset === 0}
              onClick={() => setOffset(o => Math.max(0, o - 3))}
              className="cursor-pointer rounded-full p-1 text-gray-400 hover:bg-gray-100 disabled:cursor-default disabled:opacity-30">
              <ChevronLeft size={15} />
            </button>
            <button aria-label={t('Kolejne dni')} disabled={offset + 3 >= d.days.length}
              onClick={() => setOffset(o => o + 3)}
              className="cursor-pointer rounded-full p-1 text-gray-400 hover:bg-gray-100 disabled:cursor-default disabled:opacity-30">
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {visible.map(([day, list]) => (
              <div key={day} className="min-w-0">
                <p className="mb-1.5 text-center text-[10px] font-extrabold tracking-wide text-gray-400 uppercase">
                  {dayLabel(day)}
                </p>
                <div className="flex flex-col items-stretch gap-1">
                  {(showAll ? list : list.slice(0, 4)).map(s => (
                    <button
                      key={s.appointment_id}
                      onClick={() => onPick(s)}
                      title={s.clinic_name}
                      className="cursor-pointer rounded-lg bg-surface px-1 py-1 text-center text-xs font-bold text-primary shadow-sm transition-colors hover:bg-primary hover:text-white"
                    >
                      {formatTime(s.appointment_datetime)}
                      {(s.price || multiClinic) && (
                        <span className="block text-[9px] font-semibold opacity-70">
                          {[multiClinic ? shortLoc(s.clinic_name) : null, s.price ? `${s.price} zł` : null]
                            .filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </button>
                  ))}
                  {!showAll && list.length > 4 && (
                    <button onClick={() => setShowAll(true)}
                      className="cursor-pointer rounded-lg py-0.5 text-xs font-extrabold text-primary hover:underline">
                      +{list.length - 4}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function Umow() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [spec, setSpec] = useState<string | null>(null)
  const [clinicFilter, setClinicFilter] = useState<string | null>(null)
  const [doctorFilter, setDoctorFilter] = useState<{ id: number; name: string } | null>(null)
  const [query, setQuery] = useState('')
  const [online, setOnline] = useState(false)
  const [slot, setSlot] = useState<AppointmentOut | null>(null)
  const [booked, setBooked] = useState<BookOut | null>(null)
  const [payPhase, setPayPhase] = useState<PayPhase>('idle')
  const [waitlistOpen, setWaitlistOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [notifyEarlier, setNotifyEarlier] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { asPatient, active, activeId } = useFamily()
  const { t } = useI18n()

  // zmiana profilu (ja/podopieczny) w trakcie kreatora = powrót na start,
  // żeby nie zarezerwować po cichu dla niewłaściwej osoby (płatność w toku zostaje)
  useEffect(() => {
    setStep(s => (s > 1 && payPhase === 'idle' ? 1 : s))
    if (payPhase === 'idle') { setSlot(null); setBooked(null); setSpec(null); setClinicFilter(null); setDoctorFilter(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const { data: allSlots } = useQuery({
    queryKey: ['slots'],
    queryFn: () => api<AppointmentOut[]>('/slots'),
  })
  const { data: clinicList } = useQuery({
    queryKey: ['clinics'],
    queryFn: () => api<{ clinic_id: number; clinic_name: string; address: string; city: string | null }[]>('/clinics'),
    staleTime: 300_000,
  })
  const addressOf = (name: string) => clinicList?.find(c => c.clinic_name === name)?.address
  const cityOf = (name: string) => clinicList?.find(c => c.clinic_name === name)?.city
  // placówki pogrupowane po mieście (sieciówka: 3×Warszawa, 2×Kraków…)
  const cityGroups = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const c of clinicList ?? []) map.set(c.city ?? '?', [...(map.get(c.city ?? '?') ?? []), c.clinic_name])
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [clinicList])

  const q = fold(query.trim())

  const clinicNames = useMemo(
    () => [...new Set((allSlots ?? []).map(s => s.clinic_name))].sort(),
    [allSlots],
  )

  // karty lekarzy z mini-kalendarzem: dni → godziny (jak na portalach rezerwacyjnych)
  const doctorCards = useMemo(() => {
    const map = new Map<number, { id: number; name: string; spec: string | null; clinics: Set<string>; byDay: Map<string, AppointmentOut[]> }>()
    for (const s of allSlots ?? []) {
      if (spec && s.specialization !== spec) continue
      if (clinicFilter?.startsWith('city:') && cityOf(s.clinic_name) !== clinicFilter.slice(5)) continue
      if (clinicFilter?.startsWith('cli:') && s.clinic_name !== clinicFilter.slice(4)) continue
      if (doctorFilter && s.doctor_id !== doctorFilter.id) continue
      const cur = map.get(s.doctor_id)
        ?? { id: s.doctor_id, name: s.doctor_name, spec: s.specialization, clinics: new Set<string>(), byDay: new Map<string, AppointmentOut[]>() }
      cur.clinics.add(s.clinic_name)
      const day = s.appointment_datetime.slice(0, 10)
      cur.byDay.set(day, [...(cur.byDay.get(day) ?? []), s])
      map.set(s.doctor_id, cur)
    }
    return [...map.values()]
      .filter(d => !q || fold(d.name).includes(q) || fold(d.spec ?? '').includes(q))
      .map(d => ({
        id: d.id, name: d.name, spec: d.spec, clinics: [...d.clinics],
        days: [...d.byDay.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([day, list]) => [day, list.sort((x, y) => x.appointment_datetime.localeCompare(y.appointment_datetime))] as const),
      }))
      .sort((a, b) => a.days[0][1][0].appointment_datetime.localeCompare(b.days[0][1][0].appointment_datetime))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSlots, q, spec, clinicFilter, doctorFilter, clinicList])

  // Omnisearch jak na portalach rezerwacyjnych: na focus (bez pisania) od razu
  // popularne specjalizacje i lekarze; pisanie filtruje wszystko z nagłówkami grup.
  const suggest = async (text: string): Promise<TypeaheadItem[]> => {
    const fq = fold(text.trim())
    const out: TypeaheadItem[] = []

    const specCounts = new Map<string, number>()
    for (const s of allSlots ?? []) {
      if (s.specialization) specCounts.set(s.specialization, (specCounts.get(s.specialization) ?? 0) + 1)
    }
    const matchedSpecs = [...specCounts.entries()]
      .filter(([name]) => !fq || fold(name).includes(fq))
      .sort((a, b) => b[1] - a[1])
      .slice(0, fq ? 6 : 8)
    if (matchedSpecs.length) {
      out.push({ key: 'h:spec', label: fq ? t('Specjalizacje') : t('Popularne specjalizacje'), insert: '', header: true })
      for (const [name, count] of matchedSpecs)
        out.push({ key: `spec:${name}`, label: `${name} (${count})`, insert: name })
    }

    const docs = new Map<number, { name: string; spec: string | null; earliest: string }>()
    for (const s of allSlots ?? []) {
      if (fq && !fold(s.doctor_name).includes(fq) && !fold(s.specialization ?? '').includes(fq)) continue
      const cur = docs.get(s.doctor_id)
      if (!cur || s.appointment_datetime < cur.earliest)
        docs.set(s.doctor_id, { name: s.doctor_name, spec: s.specialization, earliest: s.appointment_datetime })
    }
    const matchedDocs = [...docs.entries()].sort((a, b) => a[1].earliest.localeCompare(b[1].earliest)).slice(0, fq ? 6 : 4)
    if (matchedDocs.length) {
      out.push({ key: 'h:doc', label: t('Lekarze'), insert: '', header: true })
      for (const [id, d] of matchedDocs)
        out.push({ key: `doc:${id}:${d.name}`, label: `${d.name} — ${d.spec ?? ''}`, insert: d.name })
    }

    const matchedCities = cityGroups.filter(([city]) => fq && fold(city).includes(fq))
    const matchedClinics = (clinicList ?? []).filter(c => fq && fold(c.clinic_name + c.address).includes(fq))
    if (matchedCities.length || matchedClinics.length) {
      out.push({ key: 'h:loc', label: t('Lokalizacje'), insert: '', header: true })
      for (const [city, names] of matchedCities.slice(0, 3))
        out.push({ key: `city:${city}`, label: `${city} — ${t('miasto')} (${names.length})`, insert: city })
      for (const c of matchedClinics.slice(0, 4))
        out.push({ key: `cli:${c.clinic_name}`, label: `${c.clinic_name}, ${c.address}`, insert: c.clinic_name })
    }
    return out
  }

  const applySuggestion = (item: TypeaheadItem) => {
    const [kind, ...rest] = item.key.split(':')
    if (kind === 'spec') setSpec(rest.join(':'))
    else if (kind === 'doc') setDoctorFilter({ id: Number(rest[0]), name: rest.slice(1).join(':') })
    else if (kind === 'cli' || kind === 'city') setClinicFilter(item.key)
    setQuery('')
  }

  const pickSlot = (s: AppointmentOut) => {
    setSlot(s)
    setOnline(s.appointment_type === 'ONLINE')
    setStep(2)
    setError(null)
    setBooked(null)
    setPayPhase('idle')
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
    void queryClient.invalidateQueries({ queryKey: ['slots'] })
  }

  const book = useMutation({
    mutationFn: (id: number) => api<BookOut>(asPatient(`/appointments/${id}/book`), {
      method: 'POST',
      body: { reason: reason.trim() || null, notify_earlier: notifyEarlier, online },
    }),
    onSuccess: (data) => {
      setBooked(data)
      setPayPhase(data.payment ? 'awaiting' : 'success')
      setError(null)
      invalidate()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zarezerwować terminu.'),
  })

  const pay = useMutation({
    mutationFn: ({ id, outcome }: { id: number; outcome: 'success' | 'failure' }) =>
      api<BookOut>(`/appointments/${id}/pay`, { method: 'POST', body: { outcome } }),
    onSuccess: (data) => {
      setPayPhase(data.payment?.payment_status === 'PAID' ? 'success' : 'declined')
      setError(null)
      invalidate()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Płatność nie powiodła się.'),
  })

  const resetToSlots = () => {
    setBooked(null)
    setPayPhase('idle')
    setError(null)
    setStep(1)
    book.reset()
    pay.reset()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="fade-up flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900">{t('Umów wizytę')}</h1>
        <ol className="flex items-center gap-2">
          {[t('Termin'), t('Potwierdzenie')].map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={cx(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold',
                step > i + 1 ? 'bg-primary text-white' : step === i + 1 ? 'bg-primary-soft text-primary' : 'bg-gray-100 text-gray-400',
              )}>
                {step > i + 1 ? <Check size={13} /> : i + 1}
              </span>
              <span className={cx('hidden text-xs font-bold sm:inline', step === i + 1 ? 'text-gray-900' : 'text-gray-400')}>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      {step === 1 && (
        <Tile delay={60}>
          <TileHeader title={t('Kogo potrzebujesz?')} />
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Typeahead
                id="umow-search"
                minLength={0}
                value={query}
                onChange={setQuery}
                onPick={applySuggestion}
                search={suggest}
                placeholder={t('Szukaj lekarza, specjalizacji lub placówki…')}
              />
              {clinicNames.length > 1 && (
                <select
                  aria-label={t('Lokalizacja')}
                  className={cx(inputCls, 'sm:w-52')}
                  value={clinicFilter ?? ''}
                  onChange={e => setClinicFilter(e.target.value || null)}
                >
                  <option value="">{t('Lokalizacja')}: {t('wszystkie')}</option>
                  {cityGroups.map(([city, names]) => (
                    <optgroup key={city} label={city}>
                      {names.length > 1 && <option value={`city:${city}`}>{t('Całe miasto')}: {city}</option>}
                      {names.map(n => <option key={n} value={`cli:${n}`}>{n}</option>)}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>

            {(spec || clinicFilter || doctorFilter) && (
              <div className="flex flex-wrap items-center gap-2">
                {doctorFilter && (
                  <button onClick={() => setDoctorFilter(null)}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-extrabold text-primary hover:bg-primary hover:text-white">
                    {doctorFilter.name} <X size={12} />
                  </button>
                )}
                {spec && (
                  <button onClick={() => setSpec(null)}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-extrabold text-primary hover:bg-primary hover:text-white">
                    {spec} <X size={12} />
                  </button>
                )}
                {clinicFilter && (
                  <button onClick={() => setClinicFilter(null)}
                    title={clinicFilter.startsWith('cli:') ? addressOf(clinicFilter.slice(4)) : undefined}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-extrabold text-primary hover:bg-primary hover:text-white">
                    {clinicFilter.startsWith('city:') ? clinicFilter.slice(5) : clinicFilter.slice(4)} <X size={12} />
                  </button>
                )}
                {clinicFilter?.startsWith('cli:') && addressOf(clinicFilter.slice(4)) && (
                  <span className="text-xs font-semibold text-gray-400">{addressOf(clinicFilter.slice(4))}</span>
                )}
              </div>
            )}

            {doctorCards.length === 0 ? (
              <EmptyState
                icon={<CalendarDays size={28} strokeWidth={1.5} />}
                title={q || spec || clinicFilter ? t('Nic nie pasuje do wyszukiwania') : t('Brak wolnych terminów')}
                hint={q || spec || clinicFilter ? t('Spróbuj inaczej albo zapisz się na listę oczekujących poniżej.')
                  : t('Wróć później — placówki na bieżąco dodają nowe terminy.')}
              />
            ) : (
              <div className="space-y-3">
                {doctorCards.map(d => (
                  <DoctorCard key={d.id} d={d} multiClinic={clinicNames.length > 1} onPick={pickSlot} />
                ))}
              </div>
            )}
          </div>
          <p className="mt-4 text-sm font-medium text-gray-500">
            {t('Nie ma specjalisty, którego szukasz?')}{' '}
            <button onClick={() => setWaitlistOpen(true)} className="cursor-pointer font-extrabold text-primary hover:underline">
              {t('Zapisz się na listę oczekujących')}
            </button>
          </p>
        </Tile>
      )}

      {waitlistOpen && <WaitlistModal onClose={() => setWaitlistOpen(false)} />}

      {step === 2 && slot && (
        <Tile delay={60}>
          <TileHeader
            title={booked ? t('Płatność') : t('Potwierdzenie rezerwacji')}
            action={payPhase === 'idle' ? <Button variant="ghost" size="sm" onClick={resetToSlots}>{t('Zmień termin')}</Button> : undefined}
          />
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-gray-50 p-4">
            <DateChip month={monthShort(slot.appointment_datetime)} day={dayNo(slot.appointment_datetime)} time={formatTime(slot.appointment_datetime)} />
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-gray-900">{slot.doctor_name}</p>
              <p className="text-sm font-semibold text-gray-500">
                {slot.specialization} · {online
                  ? t('teleporada')
                  : `${slot.clinic_name}${addressOf(slot.clinic_name) ? `, ${addressOf(slot.clinic_name)}` : ''}`}
              </p>
            </div>
            <span className={cx('text-xl font-extrabold', slot.price ? 'text-gray-900' : 'text-emerald-700')}>
              {slot.price ? `${slot.price} zł` : 'NFZ'}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {active && (
              <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-bold text-amber-800">
                {t('Rezerwujesz dla: {name} (podopieczny).', { name: `${active.first_name} ${active.last_name}` })}
              </p>
            )}
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

            {payPhase === 'idle' && (
              <>
                <Field label={t('Co Ci dolega? (opcjonalnie)')} hint={t('Lekarz zobaczy to przed wizytą — pomoże mu się przygotować.')}>
                  <textarea
                    className={cx(inputCls, 'h-20 py-2.5')}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={500}
                    placeholder={t('np. od tygodnia duszności przy wysiłku…')}
                  />
                </Field>
                {slot.appointment_type !== 'ONLINE' && (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-gray-50 px-4 py-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-(--color-primary)"
                      checked={online}
                      onChange={e => setOnline(e.target.checked)}
                    />
                    <span className="text-sm font-semibold text-gray-700">
                      {t('Wolę teleporadę (wideo) — bez przychodzenia do placówki')}
                    </span>
                  </label>
                )}
                <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-gray-50 px-4 py-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-(--color-primary)"
                    checked={notifyEarlier}
                    onChange={e => setNotifyEarlier(e.target.checked)}
                  />
                  <span className="text-sm font-semibold text-gray-700">
                    {t('Powiadom mnie, jeśli u tego lekarza zwolni się wcześniejszy termin')}
                  </span>
                </label>
                <p className="text-sm font-medium text-gray-500">
                  {slot.price
                    ? t('Po rezerwacji termin blokujemy na czas płatności. Wizyta zostanie potwierdzona po jej zaksięgowaniu.')
                    : t('Wizyta w ramach NFZ — bezpłatna. Bezpłatne odwołanie do 24 godzin przed terminem.')}
                </p>
                <Button size="lg" disabled={book.isPending} onClick={() => book.mutate(slot.appointment_id)}>
                  {book.isPending ? t('Rezerwowanie…') : slot.price ? t('Rezerwuję i przechodzę do płatności') : t('Rezerwuję termin')}
                </Button>
              </>
            )}

            {payPhase === 'awaiting' && booked?.payment && (
              <>
                <p className="text-sm font-medium text-gray-500">
                  {t('Termin zablokowany. Do zapłaty:')} <span className="font-extrabold text-gray-900">{booked.payment.amount} zł</span>.{' '}
                  {t('Operator płatności jest symulowany — wybierz wynik autoryzacji.')}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button size="lg" disabled={pay.isPending}
                    onClick={() => pay.mutate({ id: slot.appointment_id, outcome: 'success' })}>
                    <CreditCard size={17} /> {t('Zapłać kartą (symulacja)')}
                  </Button>
                  <Button size="lg" variant="secondary" disabled={pay.isPending}
                    onClick={() => pay.mutate({ id: slot.appointment_id, outcome: 'failure' })}>
                    {t('Symuluj odmowę płatności')}
                  </Button>
                </div>
              </>
            )}

            {payPhase === 'success' && (
              <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><Check size={16} /></span>
                <div>
                  <p className="font-extrabold text-emerald-800">{slot.price ? t('Wizyta potwierdzona i opłacona') : t('Wizyta potwierdzona')}</p>
                  <p className="mt-0.5 text-sm font-medium text-emerald-700">
                    {t('Szczegóły znajdziesz w zakładce „Moje wizyty”. Przypomnimy Ci o wizycie dzień wcześniej.')}
                  </p>
                </div>
              </div>
            )}

            {payPhase === 'declined' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"><XCircle size={16} /></span>
                  <div>
                    <p className="font-extrabold text-red-700">{t('Płatność odrzucona')}</p>
                    <p className="mt-0.5 text-sm font-medium text-red-600">
                      {t('Termin wrócił do puli wolnych terminów. Możesz spróbować ponownie lub wybrać inny termin.')}
                    </p>
                  </div>
                </div>
                <Button variant="secondary" onClick={resetToSlots}>{t('Wróć do terminów')}</Button>
              </div>
            )}
          </div>
        </Tile>
      )}
    </div>
  )
}

function WaitlistModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const [spec, setSpec] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: entries } = useQuery({
    queryKey: ['waitlist'],
    queryFn: () => api<WaitlistEntry[]>('/waiting-list/my'),
  })

  const join = useMutation({
    mutationFn: () => api('/waiting-list', { method: 'POST', body: { specialization: spec } }),
    onSuccess: () => { setSpec(''); setError(null); void queryClient.invalidateQueries({ queryKey: ['waitlist'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać na listę.'),
  })

  const leave = useMutation({
    mutationFn: (id: number) => api(`/waiting-list/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['waitlist'] }),
  })

  return (
    <Modal
      overline="UC-P3"
      title={t('Lista oczekujących')}
      onClose={onClose}
    >
      <div className="space-y-4 pb-2">
        <p className="text-sm font-medium text-gray-500">
          {t('Gdy pojawią się nowe terminy wybranej specjalizacji, dostaniesz powiadomienie, a wpis z listy zniknie automatycznie.')}
        </p>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (spec.trim().length >= 2) join.mutate() }}>
          <Field label={t('Specjalizacja')}>
            <input className={inputCls} value={spec} onChange={e => setSpec(e.target.value)}
              placeholder={t('np. Dermatolog')} list="spec-suggestions" />
          </Field>
          <datalist id="spec-suggestions">
            {['Kardiolog', 'Internista', 'Endokrynolog', 'Dermatolog', 'Pediatra', 'Neurolog', 'Ortopeda'].map(s => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="flex items-end">
            <Button disabled={join.isPending || spec.trim().length < 2} type="submit">
              <BellPlus size={15} /> {t('Zapisz')}
            </Button>
          </div>
        </form>
        {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

        {entries && entries.length > 0 && (
          <ul className="space-y-1.5">
            {entries.map(e => (
              <li key={e.entry_id} className="flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-2.5">
                <span className="flex-1 text-sm font-bold text-gray-900">{e.specialization}</span>
                <button aria-label={t('Usuń z listy')} onClick={() => leave.mutate(e.entry_id)}
                  className="cursor-pointer rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600">
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
