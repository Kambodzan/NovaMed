import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, MapPin, Video, CalendarDays } from 'lucide-react'
import { Button, DateChip, EmptyState, Tile, TileHeader, cx } from '../ui'
import { api, ApiError } from '../lib/api'
import { dayNo, formatTime, monthShort } from '../lib/format'
import type { AppointmentOut } from '../lib/types'

export function Umow() {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [spec, setSpec] = useState<string | null>(null)
  const [slot, setSlot] = useState<AppointmentOut | null>(null)
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

  const book = useMutation({
    mutationFn: (id: number) => api<AppointmentOut>(`/appointments/${id}/book`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
      void queryClient.invalidateQueries({ queryKey: ['slots'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zarezerwować terminu.'),
  })

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
        </Tile>
      )}

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
                <Button size="sm" onClick={() => { setSlot(s); setStep(3); setError(null); book.reset() }}>Wybierz</Button>
              </li>
            ))}
          </ul>
        </Tile>
      )}

      {step === 3 && slot && (
        <Tile delay={60}>
          <TileHeader
            title="Potwierdzenie rezerwacji"
            action={!book.isSuccess ? <Button variant="ghost" size="sm" onClick={() => setStep(2)}>Zmień termin</Button> : undefined}
          />
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-gray-50 p-4">
            <DateChip month={monthShort(slot.appointment_datetime)} day={dayNo(slot.appointment_datetime)} time={formatTime(slot.appointment_datetime)} />
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-gray-900">{slot.doctor_name}</p>
              <p className="text-sm font-semibold text-gray-500">
                {slot.specialization} · {slot.appointment_type === 'ONLINE' ? 'teleporada' : slot.clinic_name}
              </p>
            </div>
          </div>

          <div className="mt-4">
            {book.isSuccess ? (
              <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><Check size={16} /></span>
                <div>
                  <p className="font-extrabold text-emerald-800">Wizyta potwierdzona</p>
                  <p className="mt-0.5 text-sm font-medium text-emerald-700">
                    Szczegóły znajdziesz w zakładce „Moje wizyty”. Przypomnimy Ci o wizycie dzień wcześniej.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <p className="mb-3 text-sm font-medium text-gray-500">
                  Wizyta w ramach NFZ — bezpłatna. Bezpłatne odwołanie do 24 godzin przed terminem.
                </p>
                {error && <p className="mb-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
                <Button size="lg" disabled={book.isPending} onClick={() => book.mutate(slot.appointment_id)}>
                  {book.isPending ? 'Rezerwowanie…' : 'Rezerwuję termin'}
                </Button>
              </>
            )}
          </div>
        </Tile>
      )}
    </div>
  )
}
