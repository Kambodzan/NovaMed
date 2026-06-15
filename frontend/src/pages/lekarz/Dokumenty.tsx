// Rejestr dokumentów wystawionych przez zalogowanego lekarza (UC-L2/L4)
// z filtrem rodzaju — szybki wgląd „co komu wystawiłem".
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, Tile, cx } from '../../ui'
import { api } from '../../lib/api'
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

  // storno — anulowanie błędnie wystawionego dokumentu (P1/ZUS też)
  const cancelDoc = async (doc: DocumentOut, reason: string) => {
    await api(`/documents/${doc.document_id}/cancel`, { method: 'POST', body: { reason: reason || undefined } })
    void queryClient.invalidateQueries({ queryKey: ['issued-documents'] })
  }

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
