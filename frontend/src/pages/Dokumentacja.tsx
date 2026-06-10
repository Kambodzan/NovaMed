import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileSignature, FileText, FlaskConical, FolderOpen, Pill } from 'lucide-react'
import { Button, EmptyState, Overline, StatusBadge, Tile, cx } from '../ui'
import { API_URL, api, getAuthToken } from '../lib/api'
import { formatDatePL } from '../lib/format'
import type { DocumentOut } from '../lib/types'

async function downloadPdf(documentId: number) {
  const resp = await fetch(`${API_URL}/documents/${documentId}/pdf`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  })
  if (!resp.ok) return
  const blob = await resp.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `novamed-dokument-${documentId}.pdf`
  a.click()
  URL.revokeObjectURL(a.href)
}

const docMeta: Record<DocumentOut['document_type'], { icon: typeof FileText; label: string }> = {
  PRESCRIPTION: { icon: Pill, label: 'E-recepta' },
  REFERRAL: { icon: FileSignature, label: 'E-skierowanie' },
  LAB_RESULT: { icon: FlaskConical, label: 'Wynik badania' },
  SICK_LEAVE: { icon: FileText, label: 'E-ZLA' },
  NOTE: { icon: FileText, label: 'Notatka z wizyty' },
}

export function Dokumentacja() {
  const [filter, setFilter] = useState<string>('ALL')
  const { data: docs } = useQuery({
    queryKey: ['my-documents'],
    queryFn: () => api<DocumentOut[]>('/documents/my'),
  })

  const filtered = (docs ?? []).filter(d => filter === 'ALL' || d.document_type === filter)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="fade-up text-[28px] font-extrabold tracking-tight text-gray-900">Moja dokumentacja</h1>

      <div className="fade-up flex flex-wrap gap-2" style={{ animationDelay: '50ms' }}>
        {['ALL', ...Object.keys(docMeta)].map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={cx(
              'cursor-pointer rounded-full px-4 py-2 text-xs font-extrabold transition-colors',
              filter === t ? 'bg-primary text-white' : 'tile-shadow bg-surface text-gray-500 hover:text-gray-900',
            )}
          >
            {t === 'ALL' ? 'Wszystkie' : docMeta[t as DocumentOut['document_type']].label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={28} strokeWidth={1.5} />}
          title="Brak dokumentów"
          hint="E-recepty, skierowania i wyniki badań pojawią się tu po wizytach u lekarza."
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
                      <Overline>{m.label} · {formatDatePL(doc.issued_at)}</Overline>
                      <p className="mt-1 text-sm leading-relaxed font-medium text-gray-600">{doc.details}</p>
                      <p className="mt-1.5 text-xs font-semibold text-gray-400">
                        {doc.doctor_name}
                        {doc.code && (
                          <> · kod: <span className="rounded-md bg-gray-100 px-2 py-0.5 font-extrabold tracking-[0.2em] text-gray-900">{doc.code}</span></>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={doc.document_status} />
                      <Button size="sm" variant="secondary" onClick={() => void downloadPdf(doc.document_id)}>
                        <Download size={14} /> Pobierz PDF
                      </Button>
                    </div>
                  </div>
                </Tile>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
