// Kartoteka pacjenta (UC-L1/UC-N1) — pełna strona dla personelu:
// dane, dokumentacja (z PDF) i historia wizyt z rozwijanym przebiegiem
// (nota + uzupełnienia + dokumenty danej wizyty).
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CalendarDays, ChevronDown, FolderOpen, MapPin, ShieldCheck, Video } from 'lucide-react'
import { Badge, Button, EmptyState, Modal, PageHeader, StatusBadge, Tile, TileHeader, cx } from '../../ui'
import { SlotCalendar } from '../../components/SlotCalendar'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime, isFuture } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { confirm } from '../../lib/confirm'
import type { AppointmentOut, DocumentOut, HistoryEntry, PatientInfo } from '../../lib/types'
import { DokumentyLista } from '../../components/DokumentyLista'

const RECEPTION_ROLES = ['rejestracja', 'kierownik', 'administrator']

export function PacjentRecord() {
  const { id } = useParams()
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const isReception = RECEPTION_ROLES.includes(me?.role ?? '')
  const [open, setOpen] = useState<string | null>(null)
  const [rescheduleFor, setRescheduleFor] = useState<AppointmentOut | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)

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
  // nadchodzące, zarezerwowane wizyty — rejestracja może je przełożyć/odwołać
  const upcoming = (visits ?? []).filter(
    v => v.appointment_status === 'CONFIRMED' && new Date(v.appointment_datetime) > new Date())

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['patient-appointments', id] })
    void queryClient.invalidateQueries({ queryKey: ['patient-history', id] })
  }
  const cancel = useMutation({
    mutationFn: (visitId: string) => api(`/appointments/${visitId}/cancel`, { method: 'POST' }),
    onSuccess: () => { setActionErr(null); refresh() },
    onError: (e) => setActionErr(e instanceof ApiError ? e.message : 'Nie udało się odwołać wizyty.'),
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

      {patient?.allergies && (
        <p className="flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-900 ring-1 ring-red-200 fade-up">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span><span className="font-extrabold tracking-wider text-red-700 uppercase">Alergie: </span>{patient.allergies}</span>
        </p>
      )}

      {actionErr && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{actionErr}</p>}

      {/* rejestracja: zarządzanie nadchodzącymi wizytami (przełóż/odwołaj — UC-P9/P10) */}
      {isReception && upcoming.length > 0 && (
        <Tile className="p-5" delay={40}>
          <TileHeader title={<span className="inline-flex items-center gap-1.5"><CalendarClock size={13} /> Nadchodzące wizyty</span>} />
          <ul className="space-y-1.5">
            {upcoming.map(v => (
              <li key={v.appointment_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3">
                <span className="text-gray-500">{v.appointment_type === 'ONLINE' ? <Video size={15} /> : <MapPin size={15} />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-gray-900 [font-variant-numeric:tabular-nums]">
                    {formatDatePL(v.appointment_datetime)}, {formatTime(v.appointment_datetime)}
                  </p>
                  <p className="truncate text-xs font-medium text-gray-500">
                    {v.doctor_id ? v.doctor_name : v.service_name} · {v.price ? `${v.price} zł` : 'NFZ'}
                  </p>
                </div>
                {v.doctor_id && (
                  <Button size="sm" variant="secondary" onClick={() => { setRescheduleFor(v); setActionErr(null) }}>Przełóż</Button>
                )}
                <Button size="sm" variant="ghost" disabled={cancel.isPending}
                  onClick={() => void confirm({
                    title: 'Odwołać wizytę?',
                    message: `Wizyta ${formatDatePL(v.appointment_datetime)}, ${formatTime(v.appointment_datetime)} zostanie odwołana, a termin wróci do puli.`,
                    tone: 'danger', confirmLabel: 'Odwołaj',
                  }).then(ok => ok && cancel.mutate(v.appointment_id))}>
                  Odwołaj
                </Button>
              </li>
            ))}
          </ul>
        </Tile>
      )}

      {rescheduleFor && (
        <StaffReschedule
          visit={rescheduleFor}
          onClose={() => setRescheduleFor(null)}
          onDone={() => { setRescheduleFor(null); refresh() }}
        />
      )}

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
                        <ChevronDown size={15} className={cx('shrink-0 text-gray-500 transition-transform', isOpen && 'rotate-180')} />
                      )}
                    </button>
                    {expandable && isOpen && (
                      <div className="space-y-2 border-t border-gray-100 px-4 py-3">
                        {d!.note ? (
                          <p className="text-sm leading-relaxed font-medium whitespace-pre-wrap text-gray-800">{d!.note}</p>
                        ) : (
                          <p className="text-sm font-medium text-gray-500">Lekarz nie zostawił noty z tej wizyty.</p>
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

// Przełożenie wizyty przez rejestrację — wybór nowego wolnego terminu u tego
// samego lekarza (backend pilnuje równości ceny i przenosi płatność).
function StaffReschedule({ visit, onClose, onDone }: {
  visit: AppointmentOut
  onClose: () => void
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const scope = visit.doctor_id ? `doctor_id=${visit.doctor_id}` : `clinic_id=${visit.clinic_id}`
  const { data: slots } = useQuery({
    queryKey: ['slots', visit.doctor_id, visit.clinic_id],
    queryFn: () => api<AppointmentOut[]>(`/slots?${scope}`),
  })
  // backend pilnuje tego samego rodzaju i ceny — pokazujemy tylko zgodne terminy
  const eligible = (slots ?? []).filter(s =>
    s.appointment_id !== visit.appointment_id
    && s.service_name === visit.service_name
    && (s.price || 0) === (visit.price || 0)
    && isFuture(s.appointment_datetime),
  )
  const reschedule = useMutation({
    mutationFn: (newId: string) => api(`/appointments/${visit.appointment_id}/reschedule`, {
      method: 'POST', body: { new_appointment_id: newId },
    }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się przełożyć wizyty.'),
  })

  return (
    <Modal
      overline={`${visit.doctor_name} · obecnie ${formatDatePL(visit.appointment_datetime)}, ${formatTime(visit.appointment_datetime)}`}
      title="Wybierz nowy termin" onClose={onClose}
    >
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      <SlotCalendar
        slots={eligible}
        busy={reschedule.isPending}
        showMeta={!visit.doctor_id || eligible.some(s => s.appointment_type === 'ONLINE')}
        onPick={s => reschedule.mutate(s.appointment_id)}
      />
    </Modal>
  )
}
