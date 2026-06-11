// Lista dokumentów pacjenta (widok personelu) z pobieraniem PDF.
import { useState } from 'react'
import { Download, FileSignature, FileText, FlaskConical, Pill } from 'lucide-react'
import { Button, EmptyState, StatusBadge } from '../ui'
import { API_URL, getAuthToken } from '../lib/api'
import { formatDatePL } from '../lib/format'
import type { DocumentOut } from '../lib/types'
import { KIND_LABEL } from './WystawDokument'

const docIcon: Record<DocumentOut['document_type'], typeof FileText> = {
  PRESCRIPTION: Pill, REFERRAL: FileSignature, LAB_RESULT: FlaskConical,
  SICK_LEAVE: FileText, NOTE: FileText,
}

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

export function DokumentyLista({ documents, emptyHint }: {
  documents: DocumentOut[]
  emptyHint?: string
}) {
  const [error, setError] = useState<string | null>(null)
  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileText size={28} strokeWidth={1.5} />}
        title="Brak dokumentów"
        hint={emptyHint ?? 'Dokumenty pojawią się po wystawieniu.'}
      />
    )
  }
  return (
    <>
    {error && <p className="mb-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
    <ul className="space-y-2">
      {documents.map(d => {
        const Icon = docIcon[d.document_type] ?? FileText
        return (
          <li key={d.document_id} className="flex flex-wrap items-start gap-3 rounded-2xl bg-gray-50 px-4 py-3">
            <span className="tile-shadow mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary">
              <Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold tracking-wider text-gray-400 uppercase">
                {KIND_LABEL[d.document_type]} · {formatDatePL(d.issued_at)}
              </p>
              <p className="mt-0.5 text-sm font-bold break-words text-gray-900">{d.details ?? '—'}</p>
              <p className="mt-0.5 text-xs font-semibold text-gray-400">
                {d.doctor_name}{d.code ? <> · kod: <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-extrabold tracking-[0.15em] text-gray-900">{d.code}</span></> : null}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StatusBadge status={d.document_status} />
              <Button size="sm" variant="ghost"
                onClick={() => downloadPdf(d.document_id).then(() => setError(null), () => setError('Nie udało się pobrać PDF — spróbuj ponownie.'))}>
                <Download size={13} /> PDF
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
    </>
  )
}
