import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellPlus, Check, ChevronRight, CreditCard, Trash2, Video, CalendarDays, XCircle } from 'lucide-react'
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

export function Umow() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [spec, setSpec] = useState<string | null>(null)
  const [doctor, setDoctor] = useState<{ id: number; name: string } | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'STATIONARY' | 'ONLINE'>('ALL')
  const [visibleDays, setVisibleDays] = useState(4)
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
    if (payPhase === 'idle') { setSlot(null); setBooked(null); setDoctor(null); setSpec(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const { data: allSlots } = useQuery({
    queryKey: ['slots'],
    queryFn: () => api<AppointmentOut[]>('/slots'),
  })

  const q = fold(query.trim())

  const specs = useMemo(() => {
    const map = new Map<string, { count: number; earliest: string }>()
    for (const s of allSlots ?? []) {
      if (!s.specialization) continue
      const cur = map.get(s.specialization)
      map.set(s.specialization, {
        count: (cur?.count ?? 0) + 1,
        earliest: cur && cur.earliest < s.appointment_datetime ? cur.earliest : s.appointment_datetime,
      })
    }
    return [...map.entries()]
      .filter(([name]) => !q || fold(name).includes(q))
      .sort((a, b) => a[0].localeCompare(b[0]))
  }, [allSlots, q])

  const doctors = useMemo(() => {
    const map = new Map<number, { id: number; name: string; spec: string | null; count: number; earliest: string }>()
    for (const s of allSlots ?? []) {
      const cur = map.get(s.doctor_id)
      map.set(s.doctor_id, {
        id: s.doctor_id, name: s.doctor_name, spec: s.specialization,
        count: (cur?.count ?? 0) + 1,
        earliest: cur && cur.earliest < s.appointment_datetime ? cur.earliest : s.appointment_datetime,
      })
    }
    return [...map.values()]
      .filter(d => !q || fold(d.name).includes(q) || fold(d.spec ?? '').includes(q))
      .sort((a, b) => a.earliest.localeCompare(b.earliest))
  }, [allSlots, q])

  const matching = useMemo(
    () => (allSlots ?? [])
      .filter(s => doctor ? s.doctor_id === doctor.id : (!spec || s.specialization === spec))
      .filter(s => typeFilter === 'ALL' || s.appointment_type === typeFilter)
      .sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime)),
    [allSlots, spec, doctor, typeFilter],
  )
  // terminy pogrupowane po dniach — zamiast jednego zwału danych
  const days = useMemo(() => {
    const map = new Map<string, AppointmentOut[]>()
    for (const s of matching) {
      const day = s.appointment_datetime.slice(0, 10)
      map.set(day, [...(map.get(day) ?? []), s])
    }
    return [...map.entries()]
  }, [matching])
  const earliestId = matching[0]?.appointment_id

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
    void queryClient.invalidateQueries({ queryKey: ['slots'] })
  }

  const book = useMutation({
    mutationFn: (id: number) => api<BookOut>(asPatient(`/appointments/${id}/book`), {
      method: 'POST',
      body: { reason: reason.trim() || null, notify_earlier: notifyEarlier },
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
    setStep(2)
    book.reset()
    pay.reset()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="fade-up flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900">{t('Umów wizytę')}</h1>
        <ol className="flex items-center gap-2">
          {[t('Specjalista'), t('Termin'), t('Potwierdzenie')].map((s, i) => (
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
            <input
              className={inputCls}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('Szukaj lekarza lub specjalizacji…')}
              autoComplete="off"
            />

            {specs.length === 0 && doctors.length === 0 ? (
              <EmptyState
                icon={<CalendarDays size={28} strokeWidth={1.5} />}
                title={q ? t('Nic nie pasuje do wyszukiwania') : t('Brak wolnych terminów')}
                hint={q ? t('Spróbuj inaczej albo zapisz się na listę oczekujących poniżej.')
                  : t('Wróć później — placówki na bieżąco dodają nowe terminy.')}
              />
            ) : (
              <>
                {specs.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-extrabold tracking-wider text-gray-400 uppercase">{t('Specjalizacje')}</p>
                    <div className="flex flex-wrap gap-2">
                      {specs.map(([s, info]) => (
                        <button
                          key={s}
                          onClick={() => { setSpec(s); setDoctor(null); setTypeFilter('ALL'); setVisibleDays(4); setStep(2) }}
                          className="cursor-pointer rounded-full bg-gray-50 px-4 py-2 text-sm font-bold text-gray-700 transition-colors hover:bg-primary-soft hover:text-primary"
                        >
                          {s} <span className="font-semibold text-gray-400">({info.count})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {doctors.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-extrabold tracking-wider text-gray-400 uppercase">{t('Lekarze')}</p>
                    <ul className="space-y-1.5">
                      {doctors.map(d => (
                        <li key={d.id}>
                          <button
                            onClick={() => { setDoctor({ id: d.id, name: d.name }); setSpec(null); setTypeFilter('ALL'); setVisibleDays(4); setStep(2) }}
                            className="group flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3 text-left hover:bg-primary-soft"
                          >
                            <Avatar initials={doctorInitials(d.name)} size="md" />
                            <span className="min-w-0 flex-1">
                              <span className="block font-bold text-gray-900 group-hover:text-primary">{d.name}</span>
                              <span className="block text-xs font-semibold text-gray-500">
                                {d.spec} · <span className="text-emerald-700">{t('najbliższy:')} {formatDatePL(d.earliest)}, {formatTime(d.earliest)}</span>
                              </span>
                            </span>
                            <ChevronRight size={16} className="shrink-0 text-gray-300 group-hover:text-primary" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
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

      {step === 2 && (
        <Tile delay={60}>
          <TileHeader
            title={doctor ? doctor.name : `${spec}`}
            action={<Button variant="ghost" size="sm" onClick={() => setStep(1)}>{t('Zmień')}</Button>}
          />
          <div className="mb-4 flex flex-wrap gap-2">
            {([['ALL', 'Wszystkie'], ['STATIONARY', 'Stacjonarne'], ['ONLINE', 'Teleporady']] as const).map(([f, label]) => (
              <button
                key={f}
                onClick={() => { setTypeFilter(f); setVisibleDays(4) }}
                className={cx(
                  'cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-extrabold transition-colors',
                  typeFilter === f ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-900',
                )}
              >
                {t(label)}
              </button>
            ))}
          </div>

          {days.length === 0 ? (
            <EmptyState
              icon={<CalendarDays size={28} strokeWidth={1.5} />}
              title={t('Brak terminów dla wybranych filtrów')}
              hint={t('Zmień filtr lub wróć do wyboru specjalisty.')}
            />
          ) : (
            <div className="space-y-4">
              {days.slice(0, visibleDays).map(([day, list]) => (
                <div key={day}>
                  <p className="mb-2 text-sm font-extrabold text-gray-900">{formatDatePL(day + 'T00:00:00')}</p>
                  <div className="flex flex-wrap gap-2">
                    {list.map(s => (
                      <button
                        key={s.appointment_id}
                        onClick={() => { setSlot(s); setStep(3); setError(null); setBooked(null); setPayPhase('idle') }}
                        className={cx(
                          'cursor-pointer rounded-2xl px-3.5 py-2 text-left transition-colors hover:bg-primary-soft',
                          s.appointment_id === earliestId ? 'bg-primary-soft ring-1 ring-primary/40' : 'bg-gray-50',
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-extrabold text-gray-900 [font-variant-numeric:tabular-nums]">
                          {formatTime(s.appointment_datetime)}
                          {s.appointment_type === 'ONLINE' && <Video size={13} className="text-sky-600" />}
                        </span>
                        <span className="block text-[11px] font-semibold text-gray-500">
                          {!doctor && `${s.doctor_name.split(' ').slice(-1)[0]} · `}
                          <span className={s.price ? 'text-gray-900' : 'text-emerald-700'}>
                            {s.price ? `${s.price} zł` : 'NFZ'}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {days.length > visibleDays && (
                <div className="text-center">
                  <Button variant="ghost" size="sm" onClick={() => setVisibleDays(d => d + 4)}>
                    {t('Pokaż kolejne dni')} ({days.length - visibleDays})
                  </Button>
                </div>
              )}
            </div>
          )}
        </Tile>
      )}

      {step === 3 && slot && (
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
                {slot.specialization} · {slot.appointment_type === 'ONLINE' ? t('teleporada') : slot.clinic_name}
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
