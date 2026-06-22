import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarPlus, ClipboardList, RefreshCw } from 'lucide-react'
import { Button, EmptyState, Field, Modal, Overline, PageHeader, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL } from '../../lib/format'
import type { DocumentOut, ProcedureOut } from '../../lib/types'
import { DatePicker } from '../../components/DatePicker'
import { TimePicker } from '../../components/TimePicker'

export function Skierowania() {
  const queryClient = useQueryClient()
  const [planFor, setPlanFor] = useState<DocumentOut | null>(null)
  const [date, setDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10))
  const [time, setTime] = useState('09:00')
  const [mode, setMode] = useState<'single' | 'series'>('single')
  const [count, setCount] = useState(5)        // liczba powtórzeń (seria)
  const [intervalDays, setIntervalDays] = useState(1)  // co ile dni
  const [error, setError] = useState<string | null>(null)

  // kolejka odświeżana w tle (near-real-time) + ręcznie przyciskiem
  const { data: referrals, refetch, isFetching } = useQuery({
    queryKey: ['nursing-referrals'],
    queryFn: () => api<DocumentOut[]>('/referrals/nursing'),
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  })

  // zabiegi już zaplanowane na wybrany dzień — żeby ostrzec o zajętej godzinie
  // (NIE blokujemy: kilka zastrzyków na tę samą godzinę to norma)
  const { data: dayProcs } = useQuery({
    queryKey: ['procedures-day', date],
    queryFn: () => api<ProcedureOut[]>(`/procedures/day?day=${date}`),
    enabled: !!planFor,
  })
  const clash = (dayProcs ?? []).filter(p => p.procedure_status === 'PLANNED' && p.procedure_datetime.slice(11, 16) === time)

  const openPlan = (r: DocumentOut) => {
    setPlanFor(r); setMode('single'); setCount(5); setIntervalDays(1); setError(null)
  }

  const plan = useMutation({
    mutationFn: () => api(`/procedures`, {
      method: 'POST',
      body: {
        referral_document_id: planFor!.document_id,
        procedure_datetime: `${date}T${time}:00`,
        occurrences: mode === 'series' ? count : 1,
        interval_days: mode === 'series' ? intervalDays : 1,
      },
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['nursing-referrals'] })
      void queryClient.invalidateQueries({ queryKey: ['procedures-day'] })
      setPlanFor(null)
      setError(null)
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zaplanować zabiegu.'),
  })

  const waiting = referrals?.length ?? 0

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="Skierowania od lekarzy"
          title="Do zaplanowania"
          sub="Po zaplanowaniu zabieg trafia do planu dnia, a skierowanie znika z tej listy"
          action={
            <Button variant="ghost" disabled={isFetching} onClick={() => void refetch()}>
              <RefreshCw size={15} className={cx(isFetching && 'animate-spin')} /> Odśwież
            </Button>
          }
        />
      </div>

      <Tile className="p-3 sm:p-4" delay={60}>
        {waiting > 0 ? (
          <>
            <Overline className="mb-2 px-1">{waiting} {waiting === 1 ? 'skierowanie czeka' : 'skierowań czeka'}</Overline>
            <ul className="space-y-1.5">
              {referrals!.map(r => (
                <li key={r.document_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-gray-900">{r.patient_name}</p>
                    <p className="truncate text-xs font-medium text-gray-500">{r.details || 'Zabieg pielęgniarski'}</p>
                    <Overline className="mt-1 !text-[10px]">
                      {r.code} · zlecenie: {r.doctor_name} · {formatDatePL(r.issued_at)}
                    </Overline>
                  </div>
                  <Button size="sm" onClick={() => openPlan(r)}>
                    <CalendarPlus size={14} /> Zaplanuj
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            icon={<ClipboardList size={28} strokeWidth={1.5} />}
            title="Wszystko zaplanowane"
            hint="Nowe skierowania od lekarzy pojawią się w tym miejscu."
          />
        )}
      </Tile>

      {planFor && (
        <Modal
          overline={`${planFor.patient_name} · ${planFor.code}`}
          title="Zaplanuj zabieg"
          onClose={() => setPlanFor(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setPlanFor(null)}>Anuluj</Button>
            <Button disabled={plan.isPending} onClick={() => plan.mutate()}>
              {plan.isPending ? 'Planowanie…' : mode === 'series' ? `Zaplanuj serię (${count})` : 'Zaplanuj zabieg'}
            </Button>
          </>}
        >
          <div className="space-y-3 pb-2">
            <p className="text-sm font-medium text-gray-600">{planFor.details}</p>

            {/* rodzaj zabiegu: jednorazowy (np. EKG) vs seria (np. zastrzyk codziennie X dni) */}
            <div className="grid grid-cols-2 gap-2">
              {([['single', 'Jednorazowy', 'np. EKG, opatrunek'], ['series', 'Seria', 'np. zastrzyk co dzień']] as const).map(([m, title, sub]) => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={cx('cursor-pointer rounded-2xl px-3.5 py-2.5 text-left transition-colors',
                    mode === m ? 'bg-primary-soft ring-2 ring-primary' : 'bg-gray-50 hover:bg-primary-soft/50')}>
                  <span className={cx('block text-sm font-extrabold', mode === m ? 'text-primary' : 'text-gray-900')}>{title}</span>
                  <span className="block text-xs font-semibold text-gray-500">{sub}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={mode === 'series' ? 'Pierwszy zabieg — data' : 'Data'}>
                <DatePicker value={date} min={new Date().toISOString().slice(0, 10)} onChange={setDate} />
              </Field>
              <Field label="Godzina"><TimePicker value={time} onChange={setTime} /></Field>
            </div>

            {clash.length > 0 && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                Masz już na {time} {clash.length === 1 ? 'zabieg' : `${clash.length} zabiegi`} ({clash[0].patient_name}{clash.length > 1 ? ' i in.' : ''}). Możesz dodać kolejny — to tylko przypomnienie.
              </p>
            )}

            {mode === 'series' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Liczba zabiegów" hint="ile razy">
                    <input type="number" min={2} max={60} className={inputCls} value={count}
                      onChange={e => setCount(Math.max(2, Math.min(60, Number(e.target.value) || 2)))} />
                  </Field>
                  <Field label="Co ile dni" hint="1 = codziennie">
                    <input type="number" min={1} max={30} className={inputCls} value={intervalDays}
                      onChange={e => setIntervalDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
                  </Field>
                </div>
                <p className="rounded-xl bg-primary-soft/60 px-3.5 py-2.5 text-xs font-semibold text-primary">
                  Utworzę {count} zabiegów o {time}, {intervalDays === 1 ? 'codziennie' : `co ${intervalDays} dni`} od {formatDatePL(date)}.
                  Skierowanie zrealizuje się po wykonaniu ostatniego.
                </p>
              </>
            )}
            {error && <p className={cx('rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700')}>{error}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
