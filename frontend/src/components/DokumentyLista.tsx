// Lista dokumentów pacjenta (widok personelu) — klik w wiersz otwiera podgląd
// (pobranie PDF w środku podglądu).
import { useState } from 'react'
import { FileSignature, FileText, FlaskConical, Pill, Stamp } from 'lucide-react'
import { PodgladDokumentu } from './PodgladDokumentu'
import { EmptyState, StatusBadge } from '../ui'
import { formatDatePL } from '../lib/format'
import type { DocumentOut } from '../lib/types'
import { KIND_LABEL } from './WystawDokument'

const docIcon: Record<DocumentOut['document_type'], typeof FileText> = {
  PRESCRIPTION: Pill, REFERRAL: FileSignature, LAB_RESULT: FlaskConical,
  SICK_LEAVE: FileText, NOTE: FileText, CERTIFICATE: Stamp,
}

export function DokumentyLista({ documents, emptyHint, byline = 'doctor', onCancel }: {
  documents: DocumentOut[]
  emptyHint?: string
  byline?: 'doctor' | 'patient' // czyje nazwisko w wierszu (rejestr lekarza → pacjent)
  onCancel?: (doc: DocumentOut, reason: string) => Promise<void> // lekarz: storno z podglądu
}) {
  const [previewFor, setPreviewFor] = useState<DocumentOut | null>(null)
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
    <ul className="space-y-2">
      {documents.map(d => {
        const Icon = docIcon[d.document_type] ?? FileText
        return (
          <li key={d.document_id}>
          <button type="button" title="Podgląd" onClick={() => setPreviewFor(d)}
            className="flex w-full cursor-pointer flex-wrap items-start gap-3 rounded-2xl bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-primary-soft/40">
            <span className="tile-shadow mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary">
              <Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold tracking-wider text-gray-400 uppercase">
                {KIND_LABEL[d.document_type]} · {formatDatePL(d.issued_at)}
              </p>
              <p className="mt-0.5 text-sm font-bold break-words text-gray-900">{d.details ?? '—'}</p>
              <p className="mt-0.5 text-xs font-semibold text-gray-400">
                {byline === 'patient' ? d.patient_name : d.doctor_name}{d.code ? <> · kod: <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-extrabold tracking-[0.15em] text-gray-900">{d.code}</span></> : null}
              </p>
            </div>
            <StatusBadge status={d.document_status} />
          </button>
          </li>
        )
      })}
    </ul>
    {previewFor && <PodgladDokumentu doc={previewFor} onClose={() => setPreviewFor(null)} onCancel={onCancel} />}
    </>
  )
}
