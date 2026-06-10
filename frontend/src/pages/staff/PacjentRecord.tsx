// Kartoteka pacjenta (UC-L1/UC-N1) — pełna strona dla personelu:
// dane, dokumentacja (z PDF) i historia wizyt.
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, FolderOpen, ShieldCheck } from 'lucide-react'
import { Badge, EmptyState, PageHeader, StatusBadge, Tile, TileHeader } from '../../ui'
import { api } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { AppointmentOut, DocumentOut, PatientInfo } from '../../lib/types'
import { DokumentyLista } from '../../components/DokumentyLista'

export function PacjentRecord() {
  const { id } = useParams()

  const { data: patient } = useQuery({
    queryKey: ['patient', Number(id)],
    queryFn: () => api<PatientInfo>(`/patients/${id}`),
  })
  const { data: documents } = useQuery({
    queryKey: ['patient-documents', Number(id)],
    queryFn: () => api<DocumentOut[]>(`/patients/${id}/documents`),
  })
  const { data: visits } = useQuery({
    queryKey: ['patient-appointments', Number(id)],
    queryFn: () => api<AppointmentOut[]>(`/patients/${id}/appointments`),
  })

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
          {visits && visits.length > 0 ? (
            <ul className="max-h-[65vh] space-y-1.5 overflow-y-auto pr-1">
              {visits.map(v => (
                <li key={v.appointment_id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-gray-50 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900 [font-variant-numeric:tabular-nums]">
                      {formatDatePL(v.appointment_datetime)}, {formatTime(v.appointment_datetime)}
                    </p>
                    <p className="text-xs font-medium text-gray-500">
                      {v.doctor_name} · {v.appointment_type === 'ONLINE' ? 'teleporada' : 'stacjonarna'}
                    </p>
                  </div>
                  <StatusBadge status={v.appointment_status} />
                </li>
              ))}
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
