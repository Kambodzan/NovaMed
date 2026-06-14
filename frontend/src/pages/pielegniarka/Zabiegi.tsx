import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardList } from 'lucide-react'
import { Button, EmptyState, Field, Modal, Overline, PageHeader, StatusBadge, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { ProcedureOut } from '../../lib/types'
import { DatePicker } from '../../components/DatePicker'

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

  const { data: procedures } = useQuery({
    queryKey: ['procedures-day', day],
    queryFn: () => api<ProcedureOut[]>(`/procedures/day?day=${day}`),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['procedures-day'] })
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

      <Tile className="p-3 sm:p-4" delay={60}>
        {(procedures ?? []).length === 0 ? (
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
                <span className="w-12 text-sm font-extrabold text-gray-400 [font-variant-numeric:tabular-nums]">
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
                    <Button size="sm" variant="ghost" onClick={() => cancel.mutate(p.procedure_id)}>Odwołaj</Button>
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
    </div>
  )
}
