// Recepty pacjenta — osobna strona (kod realizacji na pierwszym planie).
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Eye, Pill } from 'lucide-react'
import { Button, EmptyState, Overline, StatusBadge, Tile } from '../ui'
import { PodgladDokumentu } from '../components/PodgladDokumentu'
import { API_URL, api, getAuthToken } from '../lib/api'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { formatDatePL } from '../lib/format'
import type { DocumentOut } from '../lib/types'

async function downloadPdf(documentId: number) {
  const resp = await fetch(`${API_URL}/documents/${documentId}/pdf`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  })
  if (!resp.ok) throw new Error(`PDF HTTP ${resp.status}`)
  const blob = await resp.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `novamed-recepta-${documentId}.pdf`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function Recepty() {
  const { activeId, asPatient } = useFamily()
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [previewFor, setPreviewFor] = useState<DocumentOut | null>(null)

  const { data: docs } = useQuery({
    queryKey: ['my-documents', activeId],
    queryFn: () => api<DocumentOut[]>(asPatient('/documents/my')),
  })
  const recepty = (docs ?? []).filter(d => d.document_type === 'PRESCRIPTION')

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="fade-up text-[28px] font-extrabold tracking-tight text-gray-900">{t('Recepty')}</h1>
      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

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
              <Tile className="p-5" delay={80 + i * 40}>
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
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge status={doc.document_status} />
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setPreviewFor(doc)}>
                        <Eye size={14} /> {t('Podgląd')}
                      </Button>
                      <Button size="sm" variant="ghost"
                        onClick={() => downloadPdf(doc.document_id).then(() => setError(null), () => setError(t('Nie udało się pobrać PDF — spróbuj ponownie.')))}>
                        <Download size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              </Tile>
            </li>
          ))}
        </ul>
      )}

      {previewFor && <PodgladDokumentu doc={previewFor} onClose={() => setPreviewFor(null)} />}
    </div>
  )
}
