// Gabinet (UC-L1/L2): stanowisko prowadzenia wizyty — pacjent, notatka,
// wystawianie dokumentów i pełna dokumentacja na jednym ekranie.
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ClipboardPen, FolderOpen, Play, ShieldCheck, Square, User, Users, Video } from 'lucide-react'
import { Badge, Button, Modal, PageHeader, StatusBadge, Tile, TileHeader, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { AppointmentOut, DocumentOut, PatientInfo } from '../../lib/types'
import { WystawDokument } from '../../components/WystawDokument'
import { DokumentyLista } from '../../components/DokumentyLista'

export function Gabinet() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // potwierdzenia akcji bez powrotu: NO_SHOW i zakończenie z niezapisaną notatką
  const [confirm, setConfirm] = useState<'NO_SHOW' | 'COMPLETE_UNSAVED' | null>(null)

  const { data: visit } = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => api<AppointmentOut>(`/appointments/${id}`),
  })
  const patientId = visit?.patient_id

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => api<PatientInfo>(`/patients/${patientId}`),
    enabled: !!patientId,
  })
  const { data: documents } = useQuery({
    queryKey: ['patient-documents', patientId],
    queryFn: () => api<DocumentOut[]>(`/patients/${patientId}/documents`),
    enabled: !!patientId,
  })

  const changeStatus = useMutation({
    mutationFn: (status: string) => api(`/appointments/${id}/status`, { method: 'POST', body: { new_status: status } }),
    onSuccess: (_d, status) => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['appointment', id] })
      void queryClient.invalidateQueries({ queryKey: ['doctor-day'] })
      if (status === 'COMPLETED' || status === 'NO_SHOW') navigate('/')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zmienić statusu.'),
  })

  const saveNote = useMutation({
    mutationFn: () => api(`/patients/${patientId}/notes`, {
      method: 'POST', body: { appointment_id: Number(id), content: note },
    }),
    onSuccess: () => {
      setNote('')
      setNoteSaved(true)
      setTimeout(() => setNoteSaved(false), 2500)
      void queryClient.invalidateQueries({ queryKey: ['patient-documents', patientId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać notatki.'),
  })

  if (!visit) {
    return <p className="py-10 text-center text-sm font-semibold text-gray-400">Wczytywanie wizyty…</p>
  }

  const inProgress = visit.appointment_status === 'IN_PROGRESS'
  const confirmed = visit.appointment_status === 'CONFIRMED'
  const age = patient ? Math.floor((Date.now() - new Date(patient.birth_date).getTime()) / 31_557_600_000) : null
  const visitDocs = (documents ?? []).filter(d => d.appointment_id === Number(id))
  const historyDocs = (documents ?? []).filter(d => d.appointment_id !== Number(id))

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={`Gabinet · ${formatDatePL(visit.appointment_datetime)}, ${formatTime(visit.appointment_datetime)} · ${visit.appointment_type === 'ONLINE' ? 'teleporada' : 'stacjonarna'}`}
          title={visit.patient_name ?? 'Wizyta'}
          action={<>
            {confirmed && (
              <>
                <Button onClick={() => changeStatus.mutate('IN_PROGRESS')}><Play size={15} /> Rozpocznij wizytę</Button>
                <Button variant="ghost" onClick={() => setConfirm('NO_SHOW')}>Nie stawił się</Button>
              </>
            )}
            {inProgress && (
              <>
                {visit.appointment_type === 'ONLINE' && (
                  <Button variant="secondary" onClick={() => navigate(`/telewizyta/${id}`)}>
                    <Video size={15} /> Rozmowa wideo
                  </Button>
                )}
                <Button onClick={() => note.trim() ? setConfirm('COMPLETE_UNSAVED') : changeStatus.mutate('COMPLETED')}>
                  <Square size={14} /> Zakończ wizytę
                </Button>
              </>
            )}
            {!confirmed && !inProgress && <StatusBadge status={visit.appointment_status} />}
          </>}
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="space-y-4">
          {/* pacjent */}
          <Tile className="p-5" delay={60}>
            <TileHeader
              title={<span className="inline-flex items-center gap-1.5"><User size={13} /> Pacjent</span>}
              action={patientId
                ? <Link to={`/pacjent/${patientId}`} className="text-xs font-extrabold text-primary hover:underline">Pełna kartoteka</Link>
                : undefined}
            />
            {patient ? (
              <div className="space-y-1.5 text-sm">
                {/* powód wizyty na samej górze — to pierwszy kontekst, którego szuka lekarz */}
                {visit.notes && (
                  <div className="mb-2 rounded-xl bg-amber-50 px-3.5 py-2.5">
                    <p className="text-xs font-extrabold tracking-wider text-amber-700 uppercase">Powód wizyty (od pacjenta)</p>
                    <p className="mt-0.5 text-sm font-medium text-amber-900">{visit.notes}</p>
                  </div>
                )}
                <p className="text-lg font-extrabold text-gray-900">{patient.first_name} {patient.last_name}</p>
                <p className="font-medium text-gray-500">
                  PESEL {patient.pesel} · ur. {formatDatePL(patient.birth_date)}{age !== null && ` (${age} l.)`}
                </p>
                {patient.phone_number && <p className="font-medium text-gray-500">tel. {patient.phone_number}</p>}
                {patient.guardian_name && (
                  <p className="flex items-center gap-1.5 rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-sky-800">
                    <Users size={13} /> Podopieczny — opiekun: {patient.guardian_name}
                    {patient.guardian_phone && <>, tel. {patient.guardian_phone}</>}
                  </p>
                )}
                <div className="pt-1.5">
                  {patient.insurance_status
                    ? <Badge tone="success"><ShieldCheck size={12} /> eWUŚ: ubezpieczony</Badge>
                    : <Badge tone="warn"><AlertTriangle size={12} /> eWUŚ: brak potwierdzenia</Badge>}
                </div>
              </div>
            ) : <p className="text-sm font-medium text-gray-400">Wczytywanie…</p>}
          </Tile>

          {/* narzędzia wizyty dopiero po rozpoczęciu — przed wizytą lekarz
              przegląda kontekst, nie wystawia dokumentów */}
          {inProgress ? (
            <>
              <Tile className="p-5" delay={100}>
                <TileHeader title={<span className="inline-flex items-center gap-1.5"><ClipboardPen size={13} /> Notatka z wizyty</span>} />
                <textarea
                  className={cx(inputCls, 'h-36 py-2.5')}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Wywiad, badanie, rozpoznanie, zalecenia…"
                />
                <div className="mt-3 flex items-center gap-3">
                  <Button size="sm" disabled={saveNote.isPending || note.trim().length < 2} onClick={() => saveNote.mutate()}>
                    {saveNote.isPending ? 'Zapisywanie…' : 'Zapisz notatkę'}
                  </Button>
                  {noteSaved && <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><Check size={13} /> Zapisano — patrz „Z tej wizyty"</span>}
                </div>
              </Tile>

              <Tile className="p-5" delay={140}>
                <TileHeader title="Wystaw dokument" />
                {patientId && <WystawDokument patientId={patientId} appointmentId={Number(id)} hideKinds={['NOTE']} />}
              </Tile>
            </>
          ) : confirmed ? (
            <Tile className="p-5" delay={100}>
              <p className="text-sm leading-relaxed font-medium text-gray-500">
                Notatka i wystawianie dokumentów otworzą się po kliknięciu
                <span className="font-extrabold text-gray-900"> „Rozpocznij wizytę"</span> u góry.
                Do tego czasu możesz przejrzeć dane pacjenta i dokumentację.
              </p>
            </Tile>
          ) : null}
        </div>

        {confirm === 'NO_SHOW' && (
          <Modal
            overline="Gabinet"
            title="Pacjent się nie stawił?"
            onClose={() => setConfirm(null)}
            footer={<>
              <Button variant="secondary" onClick={() => setConfirm(null)}>Wróć</Button>
              <Button variant="danger" onClick={() => { setConfirm(null); changeStatus.mutate('NO_SHOW') }}>
                Tak, oznacz NO-SHOW
              </Button>
            </>}
          >
            <p className="text-sm leading-relaxed font-medium text-gray-600">
              Wizyta {visit.patient_name} zostanie oznaczona jako „nie stawił się". Tej zmiany nie można cofnąć.
            </p>
          </Modal>
        )}

        {confirm === 'COMPLETE_UNSAVED' && (
          <Modal
            overline="Gabinet"
            title="Niezapisana notatka"
            onClose={() => setConfirm(null)}
            footer={<>
              <Button variant="ghost" onClick={() => { setConfirm(null); changeStatus.mutate('COMPLETED') }}>
                Zakończ bez notatki
              </Button>
              <Button
                disabled={saveNote.isPending}
                onClick={() => saveNote.mutate(undefined, { onSuccess: () => { setConfirm(null); changeStatus.mutate('COMPLETED') } })}
              >
                <Check size={14} /> Zapisz notatkę i zakończ
              </Button>
            </>}
          >
            <p className="text-sm leading-relaxed font-medium text-gray-600">
              Masz wpisaną notatkę, która nie została zapisana w dokumentacji. Po zakończeniu wizyty wrócisz do widoku dnia.
            </p>
          </Modal>
        )}

        {/* dokumentacja: efekty TEJ wizyty osobno, nad resztą historii */}
        <Tile className="p-5" delay={120}>
          {(inProgress || visitDocs.length > 0) && (
            <div className="mb-5">
              <TileHeader title={<span className="inline-flex items-center gap-1.5 text-primary"><ClipboardPen size={13} /> Z tej wizyty</span>} />
              {visitDocs.length > 0 ? (
                <DokumentyLista documents={visitDocs} />
              ) : (
                <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-3 text-sm font-medium text-gray-400">
                  Zapisane notatki i wystawione dokumenty pojawią się tutaj od razu.
                </p>
              )}
            </div>
          )}
          <TileHeader title={<span className="inline-flex items-center gap-1.5"><FolderOpen size={13} /> Wcześniejsza dokumentacja</span>} />
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <DokumentyLista documents={historyDocs} emptyHint="Ten pacjent nie ma jeszcze wcześniejszych dokumentów." />
          </div>
        </Tile>
      </div>
    </div>
  )
}
