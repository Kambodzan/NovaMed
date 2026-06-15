// Rejestr dokumentów wystawionych przez zalogowanego lekarza (UC-L2/L4)
// z filtrem rodzaju — szybki wgląd „co komu wystawiłem".
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FlaskConical } from 'lucide-react'
import { Button, PageHeader, Tile, TileHeader, cx } from '../../ui'
import { api } from '../../lib/api'
import { formatDatePL } from '../../lib/format'
import type { DocumentOut } from '../../lib/types'
import { DokumentyLista } from '../../components/DokumentyLista'
import { KIND_LABEL } from '../../components/WystawDokument'

type Kind = DocumentOut['document_type']
const KINDS: Kind[] = ['PRESCRIPTION', 'REFERRAL', 'SICK_LEAVE', 'LAB_RESULT', 'NOTE']

export function LekarzDokumenty() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'ALL' | Kind>('ALL')
  const { data: docs } = useQuery({
    queryKey: ['issued-documents'],
    queryFn: () => api<DocumentOut[]>('/documents/issued'),
  })
  // skrzynka wyników zleconych badań, które dotarły i czekają na zapoznanie
  const { data: inbox } = useQuery({
    queryKey: ['lab-inbox'],
    queryFn: () => api<DocumentOut[]>('/documents/lab-inbox'),
  })

  // storno — anulowanie błędnie wystawionego dokumentu (P1/ZUS też)
  const cancelDoc = async (doc: DocumentOut, reason: string) => {
    await api(`/documents/${doc.document_id}/cancel`, { method: 'POST', body: { reason: reason || undefined } })
    void queryClient.invalidateQueries({ queryKey: ['issued-documents'] })
  }

  const acknowledge = useMutation({
    mutationFn: (id: string) => api(`/documents/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lab-inbox'] })
      void queryClient.invalidateQueries({ queryKey: ['issued-documents'] })
    },
  })

  const count = (k: Kind) => (docs ?? []).filter(d => d.document_type === k).length
  const shown = (docs ?? []).filter(d => filter === 'ALL' || d.document_type === filter)

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="Portal Lekarza"
          title="Wystawione dokumenty"
          sub={`${docs?.length ?? 0} dokumentów w rejestrze`}
        />
      </div>

      {(inbox?.length ?? 0) > 0 && (
        <Tile className="p-5 ring-1 ring-amber-200" delay={40}>
          <TileHeader title={<span className="inline-flex items-center gap-1.5 text-amber-700"><FlaskConical size={13} /> Wyniki do opisania <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">{inbox!.length}</span></span>} />
          <ul className="space-y-1.5">
            {inbox!.map(d => (
              <li key={d.document_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-50/60 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-gray-900">{d.details ?? 'Wynik badania'}</p>
                  <p className="text-xs font-semibold text-gray-500">{d.patient_name} · {formatDatePL(d.issued_at)}</p>
                </div>
                <Button size="sm" variant="secondary" disabled={acknowledge.isPending}
                  onClick={() => acknowledge.mutate(d.document_id)}>
                  <Check size={14} /> Oznacz jako odebrane
                </Button>
              </li>
            ))}
          </ul>
        </Tile>
      )}

      <div className="fade-up flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filtr rodzaju dokumentu">
        {(['ALL', ...KINDS] as const).map(k => (
          <button
            key={k} type="button" role="radio" aria-checked={filter === k}
            onClick={() => setFilter(k)}
            className={cx(
              'cursor-pointer rounded-full px-3.5 py-2 text-xs font-extrabold transition-colors',
              filter === k ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {k === 'ALL' ? `Wszystkie (${docs?.length ?? 0})` : `${KIND_LABEL[k]} (${count(k)})`}
          </button>
        ))}
      </div>

      <Tile className="p-5" delay={60}>
        <DokumentyLista
          documents={shown}
          byline="patient"
          onCancel={cancelDoc}
          emptyHint="Dokumenty wystawiane w gabinecie pojawią się tutaj."
        />
      </Tile>
    </div>
  )
}
