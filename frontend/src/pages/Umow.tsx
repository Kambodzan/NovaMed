import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellPlus, Check, ChevronRight, CreditCard, MapPin, Trash2, Video, CalendarDays, XCircle } from 'lucide-react'
import { Button, DateChip, EmptyState, Field, Modal, Tile, TileHeader, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import { dayNo, formatTime, monthShort } from '../lib/format'
import type { AppointmentOut, BookOut, WaitlistEntry } from '../lib/types'

type PayPhase = 'idle' | 'awaiting' | 'success' | 'declined'

export function Umow() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [spec, setSpec] = useState<string | null>(null)
  const [slot, setSlot] = useState<AppointmentOut | null>(null)
  const [booked, setBooked] = useState<BookOut | null>(null)
  const [payPhase, setPayPhase] = useState<PayPhase>('idle')
  const [waitlistOpen, setWaitlistOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: allSlots } = useQuery({
    queryKey: ['slots'],
    queryFn: () => api<AppointmentOut[]>('/slots'),
  })

  const specs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of allSlots ?? []) {
      if (s.specialization) counts.set(s.specialization, (counts.get(s.specialization) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [allSlots])

  const slots = useMemo(
    () => (allSlots ?? []).filter(s => !spec || s.specialization === spec).slice(0, 12),
    [allSlots, spec],
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
    void queryClient.invalidateQueries({ queryKey: ['slots'] })
  }

  const book = useMutation({
    mutationFn: (id: number) => api<BookOut>(`/appointments/${id}/book`, { method: 'POST' }),
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
        <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900">Umów wizytę</h1>
        <ol className="flex items-center gap-2">
          {['Specjalista', 'Termin', 'Potwierdzenie'].map((s, i) => (
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
          <TileHeader title="Kogo potrzebujesz?" />
          {specs.length === 0 ? (
            <EmptyState
              icon={<CalendarDays size={28} strokeWidth={1.5} />}
              title="Brak wolnych terminów"
              hint="Wróć później — placówki na bieżąco dodają nowe terminy."
            />
          ) : (
            <ul className="space-y-1.5">
              {specs.map(([s, count]) => (
                <li key={s}>
                  <button
                    onClick={() => { setSpec(s); setStep(2) }}
                    className="group flex w-full cursor-pointer items-center justify-between rounded-2xl bg-gray-50 px-4 py-3.5 text-left hover:bg-primary-soft"
                  >
                    <span className="font-bold text-gray-900 group-hover:text-primary">{s}</span>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-400">
                      {count} {count === 1 ? 'termin' : 'terminów'}
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-primary" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm font-medium text-gray-500">
            Nie ma specjalisty, którego szukasz?{' '}
            <button onClick={() => setWaitlistOpen(true)} className="cursor-pointer font-extrabold text-primary hover:underline">
              Zapisz się na listę oczekujących
            </button>
          </p>
        </Tile>
      )}

      {waitlistOpen && <WaitlistModal onClose={() => setWaitlistOpen(false)} />}

      {step === 2 && (
        <Tile delay={60}>
          <TileHeader
            title={`Wolne terminy — ${spec}`}
            action={<Button variant="ghost" size="sm" onClick={() => setStep(1)}>Zmień</Button>}
          />
          <ul className="space-y-2.5">
            {slots.map(s => (
              <li key={s.appointment_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 p-3">
                <DateChip month={monthShort(s.appointment_datetime)} day={dayNo(s.appointment_datetime)} time={formatTime(s.appointment_datetime)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-gray-900">{s.doctor_name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                    {s.appointment_type === 'ONLINE'
                      ? <><Video size={12} /> teleporada</>
                      : <><MapPin size={12} /> {s.clinic_name}</>}
                  </p>
                </div>
                <span className={cx('text-sm font-extrabold', s.price ? 'text-gray-900' : 'text-emerald-700')}>
                  {s.price ? `${s.price} zł` : 'NFZ'}
                </span>
                <Button size="sm" onClick={() => { setSlot(s); setStep(3); setError(null); setBooked(null); setPayPhase('idle') }}>
                  Wybierz
                </Button>
              </li>
            ))}
          </ul>
        </Tile>
      )}

      {step === 3 && slot && (
        <Tile delay={60}>
          <TileHeader
            title={booked ? 'Płatność' : 'Potwierdzenie rezerwacji'}
            action={payPhase === 'idle' ? <Button variant="ghost" size="sm" onClick={resetToSlots}>Zmień termin</Button> : undefined}
          />
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-gray-50 p-4">
            <DateChip month={monthShort(slot.appointment_datetime)} day={dayNo(slot.appointment_datetime)} time={formatTime(slot.appointment_datetime)} />
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-gray-900">{slot.doctor_name}</p>
              <p className="text-sm font-semibold text-gray-500">
                {slot.specialization} · {slot.appointment_type === 'ONLINE' ? 'teleporada' : slot.clinic_name}
              </p>
            </div>
            <span className={cx('text-xl font-extrabold', slot.price ? 'text-gray-900' : 'text-emerald-700')}>
              {slot.price ? `${slot.price} zł` : 'NFZ'}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

            {payPhase === 'idle' && (
              <>
                <p className="text-sm font-medium text-gray-500">
                  {slot.price
                    ? 'Po rezerwacji termin blokujemy na czas płatności. Wizyta zostanie potwierdzona po jej zaksięgowaniu.'
                    : 'Wizyta w ramach NFZ — bezpłatna. Bezpłatne odwołanie do 24 godzin przed terminem.'}
                </p>
                <Button size="lg" disabled={book.isPending} onClick={() => book.mutate(slot.appointment_id)}>
                  {book.isPending ? 'Rezerwowanie…' : slot.price ? 'Rezerwuję i przechodzę do płatności' : 'Rezerwuję termin'}
                </Button>
              </>
            )}

            {payPhase === 'awaiting' && booked?.payment && (
              <>
                <p className="text-sm font-medium text-gray-500">
                  Termin zablokowany. Do zapłaty: <span className="font-extrabold text-gray-900">{booked.payment.amount} zł</span>.
                  Operator płatności jest symulowany — wybierz wynik autoryzacji.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button size="lg" disabled={pay.isPending}
                    onClick={() => pay.mutate({ id: slot.appointment_id, outcome: 'success' })}>
                    <CreditCard size={17} /> Zapłać kartą (symulacja)
                  </Button>
                  <Button size="lg" variant="secondary" disabled={pay.isPending}
                    onClick={() => pay.mutate({ id: slot.appointment_id, outcome: 'failure' })}>
                    Symuluj odmowę płatności
                  </Button>
                </div>
              </>
            )}

            {payPhase === 'success' && (
              <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><Check size={16} /></span>
                <div>
                  <p className="font-extrabold text-emerald-800">Wizyta potwierdzona{slot.price ? ' i opłacona' : ''}</p>
                  <p className="mt-0.5 text-sm font-medium text-emerald-700">
                    Szczegóły znajdziesz w zakładce „Moje wizyty”. Przypomnimy Ci o wizycie dzień wcześniej.
                  </p>
                </div>
              </div>
            )}

            {payPhase === 'declined' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"><XCircle size={16} /></span>
                  <div>
                    <p className="font-extrabold text-red-700">Płatność odrzucona</p>
                    <p className="mt-0.5 text-sm font-medium text-red-600">
                      Termin wrócił do puli wolnych terminów. Możesz spróbować ponownie lub wybrać inny termin.
                    </p>
                  </div>
                </div>
                <Button variant="secondary" onClick={resetToSlots}>Wróć do terminów</Button>
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
      overline="UC-P3: brak terminów"
      title="Lista oczekujących"
      onClose={onClose}
    >
      <div className="space-y-4 pb-2">
        <p className="text-sm font-medium text-gray-500">
          Gdy pojawią się nowe terminy wybranej specjalizacji, dostaniesz powiadomienie,
          a wpis z listy zniknie automatycznie.
        </p>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (spec.trim().length >= 2) join.mutate() }}>
          <Field label="Specjalizacja">
            <input className={inputCls} value={spec} onChange={e => setSpec(e.target.value)}
              placeholder="np. Dermatolog" list="spec-suggestions" />
          </Field>
          <datalist id="spec-suggestions">
            {['Kardiolog', 'Internista', 'Endokrynolog', 'Dermatolog', 'Pediatra', 'Neurolog', 'Ortopeda'].map(s => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="flex items-end">
            <Button disabled={join.isPending || spec.trim().length < 2} type="submit">
              <BellPlus size={15} /> Zapisz
            </Button>
          </div>
        </form>
        {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

        {entries && entries.length > 0 && (
          <ul className="space-y-1.5">
            {entries.map(e => (
              <li key={e.entry_id} className="flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-2.5">
                <span className="flex-1 text-sm font-bold text-gray-900">{e.specialization}</span>
                <button aria-label="Usuń z listy" onClick={() => leave.mutate(e.entry_id)}
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
