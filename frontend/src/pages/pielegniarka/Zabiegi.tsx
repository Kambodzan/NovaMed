import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ClipboardList } from 'lucide-react'
import { Button, EmptyState, Field, Loading, Modal, Overline, PageHeader, StatusBadge, Tile, TileHeader, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { ProcedureOut } from '../../lib/types'
import { DatePicker } from '../../components/DatePicker'
import { TimePicker } from '../../components/TimePicker'
import { confirm } from '../../lib/confirm'

const todayIso = () => new Date().toISOString().slice(0, 10)

// wybrana data trzyma się przez sesję — powrót z innej zakładki nie resetuje
// jej na dziś (osobny klucz niż „Mój dzień" lekarza)
const DAY_KEY = 'novamed-nurse-day'

export function Zabiegi() {
  const queryClient = useQueryClient()
  const [day, setDayState] = useState(() => sessionStorage.getItem(DAY_KEY) ?? todayIso())
  const setDay = (d: string) => { sessionStorage.setItem(DAY_KEY, d); setDayState(d) }
  const [completeFor, setCompleteFor] = useState<ProcedureOut | null>(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [rescheduleFor, setRescheduleFor] = useState<ProcedureOut | null>(null)
  const [rsDate, setRsDate] = useState('')
  const [rsTime, setRsTime] = useState('09:00')

  const { data: procedures } = useQuery({
    queryKey: ['procedures-day', day],
    queryFn: () => api<ProcedureOut[]>(`/procedures/day?day=${day}`),
  })
  // zaległe (zaplanowane, termin minął) — żeby nie przepadły poza widokiem dnia
  const { data: overdue } = useQuery({
    queryKey: ['procedures-overdue'],
    queryFn: () => api<ProcedureOut[]>('/procedures/overdue'),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['procedures-day'] })
    void queryClient.invalidateQueries({ queryKey: ['procedures-overdue'] })
    void queryClient.invalidateQueries({ queryKey: ['nursing-referrals'] })
  }

  const complete = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      api(`/procedures/${id}/complete`, { method: 'POST', body: { notes } }),
    onSuccess: () => { invalidate(); setCompleteFor(null); setNotes(''); setError(null) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się odnotować zabiegu.'),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/procedures/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { invalidate(); setError(null) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się odwołać zabiegu.'),
  })

  const reschedule = useMutation({
    mutationFn: ({ id, dt }: { id: string; dt: string }) =>
      api(`/procedures/${id}/reschedule`, { method: 'POST', body: { procedure_datetime: dt } }),
    onSuccess: () => { invalidate(); setRescheduleFor(null); setError(null) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się przełożyć zabiegu.'),
  })

  const openReschedule = (p: ProcedureOut) => {
    setRescheduleFor(p)
    setRsDate(p.procedure_datetime.slice(0, 10))
    setRsTime(p.procedure_datetime.slice(11, 16))
    setError(null)
  }

  // zabiegi na docelowy dzień przekładania — ostrzeżenie o zajętej godzinie (bez blokady)
  const { data: rsDayProcs } = useQuery({
    queryKey: ['procedures-day', rsDate],
    queryFn: () => api<ProcedureOut[]>(`/procedures/day?day=${rsDate}`),
    enabled: !!rescheduleFor && !!rsDate,
  })
  const rsClash = (rsDayProcs ?? []).filter(p =>
    p.procedure_status === 'PLANNED'
    && p.procedure_id !== rescheduleFor?.procedure_id
    && p.procedure_datetime.slice(11, 16) === rsTime)

  const planned = (procedures ?? []).filter(p => p.procedure_status === 'PLANNED').length
  const done = (procedures ?? []).filter(p => p.procedure_status === 'DONE').length

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="Plan dnia · ze skierowań lekarskich"
          title={formatDatePL(day + 'T00:00:00')}
          sub={`${done} wykonane · ${planned} zaplanowane`}
          action={<DatePicker className="w-52" value={day} onChange={setDay} />}
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      {(overdue?.length ?? 0) > 0 && (
        <Tile className="p-4 ring-1 ring-red-200" delay={40}>
          <TileHeader title={<span className="inline-flex items-center gap-1.5 text-red-700"><AlertTriangle size={13} /> Zaległe zabiegi <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-extrabold text-red-700">{overdue!.length}</span></span>} />
          <ul className="space-y-1.5">
            {overdue!.map(p => (
              <li key={p.procedure_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-red-50/60 px-4 py-2.5">
                <span className="w-28 text-xs font-extrabold text-red-600 [font-variant-numeric:tabular-nums]">
                  {formatDatePL(p.procedure_datetime)}, {formatTime(p.procedure_datetime)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-gray-900">{p.procedure_type}</p>
                  <p className="truncate text-xs font-semibold text-gray-500">{p.patient_name}</p>
                </div>
                <Button size="sm" onClick={() => { setCompleteFor(p); setError(null) }}><Check size={14} /> Odnotuj</Button>
                <Button size="sm" variant="secondary" onClick={() => openReschedule(p)}>Przełóż</Button>
              </li>
            ))}
          </ul>
        </Tile>
      )}

      <Tile className="p-3 sm:p-4" delay={60}>
        {procedures === undefined ? <Loading /> : procedures.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={28} strokeWidth={1.5} />}
            title="Brak zabiegów tego dnia"
            hint="Zaplanuj zabiegi z zakładki „Skierowania”."
          />
        ) : (
          <ul className="space-y-1.5">
            {(procedures ?? []).map(p => (
              <li
                key={p.procedure_id}
                className={cx(
                  'flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3',
                  p.procedure_status === 'PLANNED' ? 'bg-gray-50' : 'bg-gray-50 opacity-60',
                )}
              >
                <span className="w-12 text-sm font-extrabold text-gray-500 [font-variant-numeric:tabular-nums]">
                  {formatTime(p.procedure_datetime)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-gray-900">{p.procedure_type}</p>
                  <p className="text-xs font-medium">
                    <Link to={`/pacjent/${p.patient_id}`} className="font-bold text-gray-600 hover:text-primary hover:underline">
                      {p.patient_name}
                    </Link>
                  </p>
                  <Overline className="mt-0.5 !text-[10px]">zlecenie: {p.ordered_by} · {p.referral_code}</Overline>
                  {p.notes && p.procedure_status === 'DONE' && (
                    <p className="mt-1 text-xs font-medium text-gray-500 italic">{p.notes}</p>
                  )}
                </div>
                <StatusBadge status={p.procedure_status} />
                {p.procedure_status === 'PLANNED' && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { setCompleteFor(p); setError(null) }}>
                      <Check size={14} /> Odnotuj wykonanie
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openReschedule(p)}>Przełóż</Button>
                    <Button size="sm" variant="ghost" disabled={cancel.isPending}
                      onClick={() => void confirm({
                        title: 'Odwołać zabieg?',
                        message: `Zabieg „${p.procedure_type}" dla ${p.patient_name} zostanie odwołany, a skierowanie wróci do kolejki.`,
                        tone: 'danger', confirmLabel: 'Odwołaj',
                      }).then(ok => ok && cancel.mutate(p.procedure_id))}>
                      Odwołaj
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tile>

      {completeFor && (
        <Modal
          overline="Dokumentacja czynności pielęgniarskich"
          title={`${completeFor.procedure_type} — ${completeFor.patient_name}`}
          onClose={() => setCompleteFor(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setCompleteFor(null)}>Anuluj</Button>
            <Button
              disabled={complete.isPending || notes.trim().length < 2}
              onClick={() => complete.mutate({ id: completeFor.procedure_id, notes })}
            >
              <Check size={14} /> {complete.isPending ? 'Zapisywanie…' : 'Zapisz w karcie'}
            </Button>
          </>}
        >
          <div className="pb-2">
            <Field label="Przebieg zabiegu" hint="Wymagane (min. 2 znaki) — wpis trafi do dokumentacji pacjenta przy skierowaniu.">
              <textarea
                className={cx(inputCls, 'h-24 py-2.5')}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="np. Zabieg wykonany bez powikłań, pacjentka w stanie dobrym…"
              />
            </Field>
            {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
          </div>
        </Modal>
      )}

      {rescheduleFor && (
        <Modal
          overline="Przełożenie zabiegu"
          title={`${rescheduleFor.procedure_type} — ${rescheduleFor.patient_name}`}
          onClose={() => setRescheduleFor(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setRescheduleFor(null)}>Anuluj</Button>
            <Button disabled={reschedule.isPending || !rsDate}
              onClick={() => reschedule.mutate({ id: rescheduleFor.procedure_id, dt: `${rsDate}T${rsTime}:00` })}>
              {reschedule.isPending ? 'Przekładanie…' : 'Przełóż zabieg'}
            </Button>
          </>}
        >
          <div className="grid grid-cols-2 gap-3 pb-2">
            <Field label="Nowa data"><DatePicker value={rsDate} min={todayIso()} onChange={setRsDate} /></Field>
            <Field label="Godzina"><TimePicker value={rsTime} onChange={setRsTime} /></Field>
            {rsClash.length > 0 && (
              <p className="col-span-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                Masz już na {rsTime} {rsClash.length === 1 ? 'zabieg' : `${rsClash.length} zabiegi`} ({rsClash[0].patient_name}{rsClash.length > 1 ? ' i in.' : ''}). Przełożenie jest OK — to tylko przypomnienie.
              </p>
            )}
            {error && <p className="col-span-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
