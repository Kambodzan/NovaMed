// Kartoteka pacjenta (UC-L1/UC-N1) — pełna strona dla personelu:
// dane, dokumentacja (z PDF) i historia wizyt z rozwijanym przebiegiem
// (nota + uzupełnienia + dokumenty danej wizyty).
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, ChevronDown, FolderOpen, ShieldCheck } from 'lucide-react'
import { Badge, EmptyState, PageHeader, StatusBadge, Tile, TileHeader, cx } from '../../ui'
import { api } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { AppointmentOut, DocumentOut, HistoryEntry, PatientInfo } from '../../lib/types'
import { DokumentyLista } from '../../components/DokumentyLista'

export function PacjentRecord() {
  const { id } = useParams()
  const [open, setOpen] = useState<string | null>(null)

  const { data: patient } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => api<PatientInfo>(`/patients/${id}`),
  })
  const { data: documents } = useQuery({
    queryKey: ['patient-documents', id],
    queryFn: () => api<DocumentOut[]>(`/patients/${id}/documents`),
  })
  const { data: visits } = useQuery({
    queryKey: ['patient-appointments', id],
    queryFn: () => api<AppointmentOut[]>(`/patients/${id}/appointments`),
  })
  // przebieg zakończonych wizyt (nota + uzupełnienia + dokumenty) — po appointment_id
  const { data: history } = useQuery({
    queryKey: ['patient-history', id],
    queryFn: () => api<HistoryEntry[]>(`/patients/${id}/history`),
  })
  const detail = new Map((history ?? []).map(h => [h.appointment_id, h]))

  // lekarz/pielęgniarka nie potrzebują odwołanych wizyt — to szum administracyjny
  const shown = (visits ?? []).filter(v => v.appointment_status !== 'CANCELLED')

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={patient ? `Kartoteka · PESEL ${patient.pesel} · ur. ${formatDatePL(patient.birth_date)}` : 'Kartoteka'}
          title={patient ? `${patient.first_name} ${patient.last_name}` : '…'}
          action={patient
            ? (patient.insurance_status
              ? <Badge tone="success"><ShieldCheck size={12} /> eWUŚ: ubezpieczony</Badge>
              : <Badge tone="warn"><AlertTriangle size={12} /> eWUŚ: brak potwierdzenia</Badge>)
            : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Tile className="p-5" delay={60}>
          <TileHeader title={<span className="inline-flex items-center gap-1.5"><FolderOpen size={13} /> Dokumentacja</span>} />
          <div className="max-h-[65vh] overflow-y-auto pr-1">
            <DokumentyLista documents={documents ?? []} emptyHint="Brak dokumentów w kartotece." />
          </div>
        </Tile>

        <Tile className="p-5" delay={120}>
          <TileHeader title={<span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> Historia wizyt</span>} />
          {shown.length > 0 ? (
            <ul className="max-h-[65vh] space-y-1.5 overflow-y-auto pr-1">
              {shown.map(v => {
                const d = detail.get(v.appointment_id)
                const expandable = !!d  // przebieg jest tylko dla zakończonych wizyt
                const isOpen = open === v.appointment_id
                return (
                  <li key={v.appointment_id} className="rounded-2xl bg-gray-50">
                    <button
                      type="button"
                      disabled={!expandable}
                      aria-expanded={expandable ? isOpen : undefined}
                      onClick={() => expandable && setOpen(isOpen ? null : v.appointment_id)}
                      className={cx(
                        'flex w-full items-center gap-2 px-4 py-2.5 text-left',
                        expandable && 'cursor-pointer',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900 [font-variant-numeric:tabular-nums]">
                          {formatDatePL(v.appointment_datetime)}, {formatTime(v.appointment_datetime)}
                        </p>
                        <p className="text-xs font-medium text-gray-500">
                          {v.doctor_name} · {v.appointment_type === 'ONLINE' ? 'teleporada' : 'stacjonarna'}
                          {expandable && !d!.note ? ' · brak noty' : ''}
                        </p>
                      </div>
                      <StatusBadge status={v.appointment_status} />
                      {expandable && (
                        <ChevronDown size={15} className={cx('shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
                      )}
                    </button>
                    {expandable && isOpen && (
                      <div className="space-y-2 border-t border-gray-100 px-4 py-3">
                        {d!.note ? (
                          <p className="text-sm leading-relaxed font-medium whitespace-pre-wrap text-gray-800">{d!.note}</p>
                        ) : (
                          <p className="text-sm font-medium text-gray-400">Lekarz nie zostawił noty z tej wizyty.</p>
                        )}
                        {d!.addenda.map((a, j) => (
                          <p key={j} className="border-l-2 border-primary/40 pl-3 text-sm font-medium whitespace-pre-wrap text-gray-700">
                            <span className="text-[11px] font-extrabold tracking-wider text-primary/70 uppercase">Uzupełnienie: </span>{a}
                          </p>
                        ))}
                        {d!.documents.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {d!.documents.map((doc, j) => (
                              <span key={j} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-gray-600 tile-shadow">
                                {doc.label}{doc.code ? ` · ${doc.code}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<CalendarDays size={28} strokeWidth={1.5} />}
              title="Brak wizyt"
              hint="Historia wizyt pacjenta pojawi się tutaj."
            />
          )}
        </Tile>
      </div>
    </div>
  )
}
