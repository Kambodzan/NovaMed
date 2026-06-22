// Lista dokumentów pacjenta (widok personelu) — klik w wiersz otwiera podgląd
// (pobranie PDF w środku podglądu).
import { useMemo, useState } from 'react'
import { FileSignature, FileText, FlaskConical, Pill, Search, Stamp, X } from 'lucide-react'
import { PodgladDokumentu } from './PodgladDokumentu'
import { EmptyState, StatusBadge, cx, inputCls } from '../ui'
import { formatDatePL } from '../lib/format'
import type { DocumentOut } from '../lib/types'
import { KIND_LABEL } from './WystawDokument'

// znaki diakrytyczne pomijamy (np. „ł"→„l"), żeby szukać bez polskich liter
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

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
  const [q, setQ] = useState('')
  // omni-search po wszystkim w wierszu: typ, treść, kod, nazwisko, data
  const filtered = useMemo(() => {
    const needle = norm(q.trim())
    if (!needle) return documents
    return documents.filter(d => norm([
      KIND_LABEL[d.document_type], d.details, d.code,
      byline === 'patient' ? d.patient_name : d.doctor_name, formatDatePL(d.issued_at),
    ].filter(Boolean).join(' ')).includes(needle))
  }, [documents, q, byline])

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
    {documents.length > 4 && (
      <div className="relative mb-2.5">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400" />
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Szukaj w dokumentach — typ, treść, kod, data…"
          className={cx(inputCls, 'pl-10', q && 'pr-10')}
        />
        {q && (
          <button type="button" aria-label="Wyczyść" onClick={() => setQ('')}
            className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-gray-400 hover:text-gray-700">
            <X size={15} />
          </button>
        )}
      </div>
    )}
    {filtered.length === 0 ? (
      <p className="rounded-2xl bg-gray-50 px-4 py-6 text-center text-sm font-medium text-gray-500">
        Nic nie pasuje do „{q}".
      </p>
    ) : (
    <ul className="space-y-2">
      {filtered.map(d => {
        const Icon = docIcon[d.document_type] ?? FileText
        return (
          <li key={d.document_id}>
          <button type="button" title="Podgląd" onClick={() => setPreviewFor(d)}
            className="flex w-full cursor-pointer flex-wrap items-start gap-3 rounded-2xl bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-primary-soft/40">
            <span className="tile-shadow mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary">
              <Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold tracking-wider text-gray-500 uppercase">
                {KIND_LABEL[d.document_type]} · {formatDatePL(d.issued_at)}
              </p>
              <p className="mt-0.5 text-sm font-bold break-words text-gray-900">{d.details ?? '—'}</p>
              <p className="mt-0.5 text-xs font-semibold text-gray-500">
                {byline === 'patient' ? d.patient_name : d.doctor_name}{d.code ? <> · kod: <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-extrabold tracking-[0.15em] text-gray-900">{d.code}</span></> : null}
              </p>
            </div>
            <StatusBadge status={d.document_status} />
          </button>
          </li>
        )
      })}
    </ul>
    )}
    {previewFor && <PodgladDokumentu doc={previewFor} onClose={() => setPreviewFor(null)} onCancel={onCancel} />}
    </>
  )
}
