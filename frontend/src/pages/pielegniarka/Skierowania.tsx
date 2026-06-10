import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, ClipboardList } from 'lucide-react'
import { Button, EmptyState, Field, Modal, Overline, PageHeader, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL } from '../../lib/format'
import type { DocumentOut } from '../../lib/types'

export function Skierowania() {
  const queryClient = useQueryClient()
  const [planFor, setPlanFor] = useState<DocumentOut | null>(null)
  const [date, setDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10))
  const [time, setTime] = useState('09:00')
  const [error, setError] = useState<string | null>(null)

  const { data: referrals } = useQuery({
    queryKey: ['nursing-referrals'],
    queryFn: () => api<DocumentOut[]>('/referrals/nursing'),
  })

  const plan = useMutation({
    mutationFn: () => api(`/procedures`, {
      method: 'POST',
      body: {
        referral_document_id: planFor!.document_id,
        procedure_datetime: `${date}T${time}:00`,
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

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="Skierowania od lekarzy"
          title="Do zaplanowania"
          sub="Po zaplanowaniu zabieg trafia do planu dnia, a skierowanie znika z tej listy"
        />
      </div>

      <Tile className="p-3 sm:p-4" delay={60}>
        {referrals && referrals.length > 0 ? (
          <ul className="space-y-1.5">
            {referrals.map(r => (
              <li key={r.document_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-gray-900">{r.patient_name}</p>
                  <p className="truncate text-xs font-medium text-gray-500">{r.details || 'Zabieg pielęgniarski'}</p>
                  <Overline className="mt-1 !text-[10px]">
                    {r.code} · zlecenie: {r.doctor_name} · {formatDatePL(r.issued_at)}
                  </Overline>
                </div>
                <Button size="sm" onClick={() => { setPlanFor(r); setError(null) }}>
                  <CalendarPlus size={14} /> Zaplanuj
                </Button>
              </li>
            ))}
          </ul>
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
              {plan.isPending ? 'Planowanie…' : 'Zaplanuj zabieg'}
            </Button>
          </>}
        >
          <div className="space-y-3 pb-2">
            <p className="text-sm font-medium text-gray-600">{planFor.details}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Data"><input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} /></Field>
              <Field label="Godzina"><input type="time" className={inputCls} value={time} onChange={e => setTime(e.target.value)} /></Field>
            </div>
            {error && <p className={cx('rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700')}>{error}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
