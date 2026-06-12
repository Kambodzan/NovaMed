// Recepty pacjenta — osobna strona (kod realizacji na pierwszym planie).
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pill } from 'lucide-react'
import { EmptyState, Overline, StatusBadge, Tile } from '../ui'
import { PodgladDokumentu } from '../components/PodgladDokumentu'
import { api } from '../lib/api'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { formatDatePL } from '../lib/format'
import type { DocumentOut } from '../lib/types'

export function Recepty() {
  const { activeId, asPatient } = useFamily()
  const { t } = useI18n()
  const [previewFor, setPreviewFor] = useState<DocumentOut | null>(null)

  const { data: docs } = useQuery({
    queryKey: ['my-documents', activeId],
    queryFn: () => api<DocumentOut[]>(asPatient('/documents/my')),
  })
  const recepty = (docs ?? []).filter(d => d.document_type === 'PRESCRIPTION')

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="fade-up text-[28px] font-extrabold tracking-tight text-gray-900">{t('Recepty')}</h1>

      {recepty.length === 0 ? (
        <EmptyState
          icon={<Pill size={28} strokeWidth={1.5} />}
          title={t('Brak recept')}
          hint={t('E-recepty wystawione przez lekarza pojawią się tutaj z kodem do realizacji w aptece.')}
        />
      ) : (
        <ul className="space-y-3">
          {recepty.map((doc, i) => (
            <li key={doc.document_id}>
              <button type="button" className="block w-full cursor-pointer text-left"
                onClick={() => setPreviewFor(doc)} title={t('Podgląd')}>
                <Tile className="p-5 transition-shadow hover:ring-2 hover:ring-primary/20" delay={80 + i * 40}>
                  <div className="flex flex-wrap items-center gap-4">
                    {doc.code && (
                      <div className="rounded-2xl bg-primary-soft px-5 py-3 text-center">
                        <p className="text-[10px] font-extrabold tracking-wider text-primary/60 uppercase">{t('kod recepty')}</p>
                        <p className="text-2xl font-extrabold tracking-[0.3em] text-primary">{doc.code}</p>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <Overline>{formatDatePL(doc.issued_at)} · {doc.doctor_name}</Overline>
                      <p className="mt-1 text-sm leading-relaxed font-medium text-gray-700">{doc.details}</p>
                      <p className="mt-1 text-xs font-medium text-gray-400">{t('W aptece podaj kod i PESEL.')}</p>
                    </div>
                    <StatusBadge status={doc.document_status} />
                  </div>
                </Tile>
              </button>
            </li>
          ))}
        </ul>
      )}

      {previewFor && <PodgladDokumentu doc={previewFor} onClose={() => setPreviewFor(null)} />}
    </div>
  )
}
