import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Eye, FileText, FlaskConical, FolderOpen } from 'lucide-react'
import { PodgladDokumentu } from '../components/PodgladDokumentu'
import { Button, EmptyState, Overline, StatusBadge, Tile, cx } from '../ui'
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
  a.download = `novamed-dokument-${documentId}.pdf`
  a.click()
  URL.revokeObjectURL(a.href)
}

// recepty i skierowania mają własne strony — tu zostaje reszta dokumentacji
const docMeta: Record<string, { icon: typeof FileText; label: string }> = {
  LAB_RESULT: { icon: FlaskConical, label: 'Wynik badania' },
  SICK_LEAVE: { icon: FileText, label: 'E-ZLA' },
  NOTE: { icon: FileText, label: 'Notatka z wizyty' },
}

export function Dokumentacja() {
  const [filter, setFilter] = useState<string>('ALL')
  const [error, setError] = useState<string | null>(null)
  const [previewFor, setPreviewFor] = useState<DocumentOut | null>(null)
  const { activeId, asPatient } = useFamily()
  const { t } = useI18n()
  const { data: docs } = useQuery({
    queryKey: ['my-documents', activeId],
    queryFn: () => api<DocumentOut[]>(asPatient('/documents/my')),
  })

  const filtered = (docs ?? [])
    .filter(d => d.document_type in docMeta)
    .filter(d => filter === 'ALL' || d.document_type === filter)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="fade-up text-[28px] font-extrabold tracking-tight text-gray-900">{t('Moja dokumentacja')}</h1>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <div className="fade-up flex flex-wrap gap-2" style={{ animationDelay: '50ms' }}>
        {['ALL', ...Object.keys(docMeta)].map(kind => (
          <button
            key={kind}
            onClick={() => setFilter(kind)}
            className={cx(
              'cursor-pointer rounded-full px-4 py-2 text-xs font-extrabold transition-colors',
              filter === kind ? 'bg-primary text-white' : 'tile-shadow bg-surface text-gray-500 hover:text-gray-900',
            )}
          >
            {kind === 'ALL' ? t('Wszystkie') : t(docMeta[kind].label)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={28} strokeWidth={1.5} />}
          title={t('Brak dokumentów')}
          hint={t('E-recepty, skierowania i wyniki badań pojawią się tu po wizytach u lekarza.')}
        />
      ) : (
        <ul className="space-y-3">
          {filtered.map((doc, i) => {
            const m = docMeta[doc.document_type]
            return (
              <li key={doc.document_id}>
                <Tile className="p-5" delay={100 + i * 40}>
                  <div className="flex flex-wrap items-start gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <m.icon size={19} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Overline>{t(m.label)} · {formatDatePL(doc.issued_at)}</Overline>
                      <p className="mt-1 text-sm leading-relaxed font-medium text-gray-600">{doc.details}</p>
                      <p className="mt-1.5 text-xs font-semibold text-gray-400">
                        {doc.doctor_name}
                        {doc.code && (
                          <> · {t('kod:')} <span className="rounded-md bg-gray-100 px-2 py-0.5 font-extrabold tracking-[0.2em] text-gray-900">{doc.code}</span></>
                        )}
                      </p>
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
            )
          })}
        </ul>
      )}

      {previewFor && (
        <PodgladDokumentu
          documentId={previewFor.document_id}
          title={previewFor.details ?? t('Dokument')}
          onClose={() => setPreviewFor(null)}
        />
      )}
    </div>
  )
}
