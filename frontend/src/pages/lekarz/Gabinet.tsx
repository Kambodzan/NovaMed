// Gabinet (UC-L1/L2): stanowisko prowadzenia wizyty — pacjent, notatka,
// wystawianie dokumentów i pełna dokumentacja na jednym ekranie.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronDown, ClipboardPen, FileCheck2, FolderOpen, History, Lock, Pause, Play, Plus, Printer, ShieldCheck, Square, User, Users, Video } from 'lucide-react'
import { Badge, Button, Field, Modal, PageHeader, StatusBadge, Tile, TileHeader, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import type { AppointmentOut, ClinicalNote, DocumentOut, HistoryEntry, PatientInfo } from '../../lib/types'
import { KIND_LABEL, WystawDokument, searchIcd10 } from '../../components/WystawDokument'
import { DokumentyLista } from '../../components/DokumentyLista'
import { Typeahead } from '../../components/Typeahead'

// notatka strukturalna — sekcje sklejane do jednego dokumentu NOTE;
// Rozpoznanie jest osobnym, JEDNYM polem (ICD-10) — wchodzi do notatki
// i automatycznie do wystawianych recept/skierowań
const EMPTY_NOTE = { wywiad: '', badanie: '', zalecenia: '' }
// szablony noty (autotekst) — ogólne rusztowania częstych wizyt; lekarz dopisuje
// szczegóły. Celowo BEZ kodu ICD-10 (rozpoznanie wpisuje lekarz osobno).
const NOTE_TEMPLATES: Array<{ label: string; wywiad: string; badanie: string; zalecenia: string }> = [
  { label: 'Wizyta kontrolna', wywiad: 'Wizyta kontrolna — choroba przewlekła, stan stabilny, bez nowych dolegliwości. Leczenie tolerowane dobrze.', badanie: 'Stan ogólny dobry. Badaniem przedmiotowym bez istotnych odchyleń.', zalecenia: 'Kontynuacja dotychczasowego leczenia. Kontrola za … . Pilne zgłoszenie przy nasileniu objawów.' },
  { label: 'Kontynuacja recepty', wywiad: 'Wizyta receptowa — kontynuacja leczenia przewlekłego. Bez nowych dolegliwości, leki tolerowane dobrze.', badanie: '', zalecenia: 'Kontynuacja dotychczasowych leków w dawkach jak dotąd. Kontrola za … .' },
  { label: 'Infekcja dróg oddechowych', wywiad: 'Od … dni: gorączka do …°C, ból gardła, katar, kaszel. Bez duszności.', badanie: 'Gardło zaczerwienione, węzły chłonne szyjne … . Osłuchowo nad płucami szmer pęcherzykowy prawidłowy.', zalecenia: 'Leczenie objawowe, nawodnienie, odpoczynek. Kontrola przy braku poprawy / nasileniu objawów.' },
  { label: 'Omówienie wyników', wywiad: 'Wizyta w celu omówienia wyników badań ( … ). Samopoczucie … .', badanie: 'Stan ogólny dobry. Bez istotnych odchyleń w badaniu przedmiotowym.', zalecenia: 'Omówiono wyniki. Dalsze postępowanie: … . Kontrola za … .' },
  { label: 'Dolegliwości bólowe', wywiad: 'Od … : ból w okolicy … , charakter … , nasilenie …/10, czynniki nasilające/łagodzące … .', badanie: 'Okolica … — palpacyjnie … . Ruchomość … . Bez objawów alarmowych.', zalecenia: 'Leczenie przeciwbólowe, oszczędzający tryb. Kontrola / dalsza diagnostyka przy braku poprawy.' },
  { label: 'Zaostrzenie przewlekłe', wywiad: 'Zaostrzenie choroby przewlekłej ( … ) od … . Objawy: … .', badanie: 'Stan ogólny … . Odchylenia: … .', zalecenia: 'Modyfikacja leczenia: … . Kontrola za … . Wskazania do pilnej konsultacji omówiono.' },
  { label: 'Badanie profilaktyczne', wywiad: 'Wizyta profilaktyczna / bilans. Bez zgłaszanych dolegliwości. Wywiad rodzinny: … .', badanie: 'Stan ogólny dobry. Pomiary: masa … , wzrost … , RR …/… mmHg. Bez odchyleń.', zalecenia: 'Zdrowy styl życia. Badania profilaktyczne: … . Kontrola za … .' },
  { label: 'Porada / konsultacja', wywiad: 'Pacjent zgłasza … . Czas trwania … , okoliczności … .', badanie: 'Badaniem przedmiotowym: … .', zalecenia: 'Zalecono … . Kontrola w razie potrzeby.' },
]
const NOTE_SECTIONS: Array<{ key: keyof typeof EMPTY_NOTE; label: string; placeholder: string; tall?: boolean }> = [
  { key: 'wywiad', label: 'Wywiad', placeholder: 'co zgłasza pacjent, od kiedy, okoliczności…', tall: true },
  { key: 'badanie', label: 'Badanie przedmiotowe', placeholder: 'wynik badania w gabinecie…' },
  { key: 'zalecenia', label: 'Zalecenia', placeholder: 'leczenie, kontrola, na co uważać…', tall: true },
]
const composeNote = (n: typeof EMPTY_NOTE, rozpoznanie: string) => [
  n.wywiad.trim() && `Wywiad: ${n.wywiad.trim()}`,
  n.badanie.trim() && `Badanie przedmiotowe: ${n.badanie.trim()}`,
  rozpoznanie.trim() && `Rozpoznanie: ${rozpoznanie.trim()}`,
  n.zalecenia.trim() && `Zalecenia: ${n.zalecenia.trim()}`,
].filter(Boolean).join('\n\n')

// odwrotność composeNote — wczytanie istniejącego szkicu z powrotem do pól SOAP
function parseNote(content: string): { wywiad: string; badanie: string; rozpoznanie: string; zalecenia: string } {
  const out = { wywiad: '', badanie: '', rozpoznanie: '', zalecenia: '' }
  const labels: Array<[keyof typeof out, RegExp]> = [
    ['wywiad', /^Wywiad:\s*/],
    ['badanie', /^Badanie przedmiotowe:\s*/],
    ['rozpoznanie', /^Rozpoznanie:\s*/],
    ['zalecenia', /^Zalecenia:\s*/],
  ]
  for (const block of content.split('\n\n')) {
    for (const [key, re] of labels) {
      if (re.test(block)) { out[key] = block.replace(re, '').trim(); break }
    }
  }
  return out
}

const NOTE_ACTION_LABEL: Record<string, string> = {
  CREATED: 'Utworzono szkic', SAVED: 'Zapisano szkic', SIGNED: 'Podpisano', ADDENDUM: 'Uzupełnienie',
}

type DocKind = DocumentOut['document_type']
const HIST_KINDS: DocKind[] = ['PRESCRIPTION', 'REFERRAL', 'LAB_RESULT', 'SICK_LEAVE', 'CERTIFICATE']

export function Gabinet() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [note, setNote] = useState(EMPTY_NOTE)
  const [rozpoznanie, setRozpoznanie] = useState('')
  const [addendum, setAddendum] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)  // „Gotowe szablony" — domyślnie schowane
  const [error, setError] = useState<string | null>(null)
  // potwierdzenia akcji bez powrotu: NO_SHOW i zakończenie z niezapisanym szkicem
  const [confirm, setConfirm] = useState<'NO_SHOW' | 'COMPLETE_UNSAVED' | null>(null)
  // historia dokumentów: domyślnie zwinięta, z filtrem rodzaju i limitem
  const [histOpen, setHistOpen] = useState(false)
  const [histFilter, setHistFilter] = useState<'ALL' | DocKind>('ALL')
  const [histLimit, setHistLimit] = useState(8)
  const [revOpen, setRevOpen] = useState(false)  // „Historia zmian" (audyt)

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
  // historia wizyt z notami — ciągłość leczenia (co było, rozpoznanie, zalecenia)
  const { data: history } = useQuery({
    queryKey: ['patient-history', patientId],
    queryFn: () => api<HistoryEntry[]>(`/patients/${patientId}/history`),
    enabled: !!patientId,
  })
  // indeksy ROZWINIĘTYCH wizyt — niezależne przełączniki (można otworzyć kilka
  // naraz, zostają otwarte do ponownego kliknięcia). Domyślnie ostatnia (0).
  const [openHist, setOpenHist] = useState<Set<number>>(() => new Set([0]))
  const toggleHist = (i: number) => setOpenHist(prev => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })
  // nota z wizyty (encounter note) — szkic/podpis/uzupełnienia + audyt
  const { data: clinicalNote } = useQuery({
    queryKey: ['note', id],
    queryFn: () => api<ClinicalNote>(`/appointments/${id}/note`),
    enabled: !!id,
  })
  const noteStatus = clinicalNote?.status ?? 'EMPTY'
  const signed = noteStatus === 'SIGNED'
  const savedContent = clinicalNote?.content ?? ''
  const composed = composeNote(note, rozpoznanie)
  // niezapisany szkic = pola różnią się od zapisanej treści (i jest co zapisać)
  const unsavedNote = !signed && composed.length >= 2 && composed !== savedContent

  // wczytaj istniejący szkic do pól SOAP raz, gdy nota się załaduje
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (clinicalNote && !hydratedRef.current && clinicalNote.content) {
      const p = parseNote(clinicalNote.content)
      setNote({ wywiad: p.wywiad, badanie: p.badanie, zalecenia: p.zalecenia })
      setRozpoznanie(p.rozpoznanie)
      hydratedRef.current = true
    }
  }, [clinicalNote])

  const invalidateNote = () => void queryClient.invalidateQueries({ queryKey: ['note', id] })

  // storno dokumentu z poziomu gabinetu (np. tuż po pomyłkowym wystawieniu)
  const cancelDoc = async (doc: DocumentOut, reason: string) => {
    await api(`/documents/${doc.document_id}/cancel`, { method: 'POST', body: { reason: reason || undefined } })
    void queryClient.invalidateQueries({ queryKey: ['patient-documents', patientId] })
  }

  // dane kliniczne pacjenta (alergie/choroby/leki) — prowadzi lekarz
  const [clinicalOpen, setClinicalOpen] = useState(false)
  const [clin, setClin] = useState({ allergies: '', chronic_diseases: '', chronic_medications: '' })
  const openClinical = () => {
    setClin({
      allergies: patient?.allergies ?? '',
      chronic_diseases: patient?.chronic_diseases ?? '',
      chronic_medications: patient?.chronic_medications ?? '',
    })
    setClinicalOpen(true)
  }
  const saveClinical = useMutation({
    mutationFn: () => api(`/patients/${patientId}/clinical`, { method: 'PATCH', body: clin }),
    onSuccess: () => { setError(null); setClinicalOpen(false); void queryClient.invalidateQueries({ queryKey: ['patient', patientId] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać danych klinicznych.'),
  })

  const changeStatus = useMutation({
    mutationFn: (status: string) => api(`/appointments/${id}/status`, { method: 'POST', body: { new_status: status } }),
    onSuccess: (_d, status) => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['appointment', id] })
      void queryClient.invalidateQueries({ queryKey: ['doctor-day'] })
      void queryClient.invalidateQueries({ queryKey: ['doctor-active'] })  // pasek „wizyta w toku"
      invalidateNote()  // zakończenie auto-podpisuje notę
      // zakończona/nieodbyta — koniec wizyty; wstrzymana — lekarz wraca po kolejnego pacjenta
      if (status === 'COMPLETED' || status === 'NO_SHOW' || status === 'PAUSED') navigate('/')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zmienić statusu.'),
  })

  const saveDraft = useMutation({
    mutationFn: () => api<ClinicalNote>(`/appointments/${id}/note`, { method: 'PUT', body: { content: composed } }),
    onSuccess: () => {
      setNoteSaved(true)
      setTimeout(() => setNoteSaved(false), 2500)
      invalidateNote()
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać szkicu.'),
  })

  const signNote = useMutation({
    mutationFn: () => api<ClinicalNote>(`/appointments/${id}/note/sign`, { method: 'POST' }),
    onSuccess: () => { setError(null); invalidateNote() },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się podpisać noty.'),
  })

  const addAddendum = useMutation({
    mutationFn: () => api<ClinicalNote>(`/appointments/${id}/note/addenda`, { method: 'POST', body: { content: addendum.trim() } }),
    onSuccess: () => { setAddendum(''); setError(null); invalidateNote() },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się dodać uzupełnienia.'),
  })

  if (!visit) {
    return <p className="py-10 text-center text-sm font-semibold text-gray-400">Wczytywanie wizyty…</p>
  }

  const inProgress = visit.appointment_status === 'IN_PROGRESS'
  const paused = visit.appointment_status === 'PAUSED'
  const active = inProgress || paused  // wizyta otwarta — nota i dokumenty dostępne
  const confirmed = visit.appointment_status === 'CONFIRMED'
  // wstrzymanie: najpierw zapisz szkic (żeby nie utracić wypełnień), potem pauza
  const pauseVisit = () => unsavedNote
    ? saveDraft.mutate(undefined, { onSuccess: () => changeStatus.mutate('PAUSED') })
    : changeStatus.mutate('PAUSED')
  // wizytę rozpoczyna się w dniu jej terminu
  // TEMP (testy): strażnik dnia wyłączony, żeby dało się rozpoczynać wizyty z innego dnia.
  // Przywrócić: const visitToday = new Date(visit.appointment_datetime).toDateString() === new Date().toDateString()
  const visitToday = true
  const age = patient ? Math.floor((Date.now() - new Date(patient.birth_date).getTime()) / 31_557_600_000) : null
  const visitDocs = (documents ?? []).filter(d => d.appointment_id === id)
  const historyDocs = (documents ?? []).filter(d => d.appointment_id !== id)
  const histShown = historyDocs.filter(d => histFilter === 'ALL' || d.document_type === histFilter)
  const histCount = (k: DocKind) => historyDocs.filter(d => d.document_type === k).length

  // kartka na koniec: podsumowanie wizyty do druku (okno systemowe drukarki)
  const printSummary = () => {
    if (!patient) return
    const w = window.open('', '_blank', 'width=780,height=920')
    if (!w) return
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const others = visitDocs  // noty nie są już dokumentami — są w clinicalNote
    const noteHtml = clinicalNote && clinicalNote.status === 'SIGNED' && clinicalNote.content
      ? `<div class="sec"><h2>Przebieg wizyty i zalecenia</h2><pre>${esc(clinicalNote.content)}</pre>`
        + clinicalNote.addenda.map(a => `<pre style="margin-top:8px"><strong>Uzupełnienie (${esc(a.author_name)}):</strong> ${esc(a.content)}</pre>`).join('')
        + '</div>'
      : ''
    w.document.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Podsumowanie wizyty — ${esc(visit.patient_name ?? '')}</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;margin:42px;color:#111;font-size:14px;line-height:1.5}
  h1{font-size:19px;margin:0}
  .muted{color:#666;font-size:12px}
  .sec{margin-top:18px;border-top:1px solid #ddd;padding-top:10px}
  .sec h2{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#555;margin:0 0 6px}
  .doc{margin:8px 0;padding:9px 12px;border:1px solid #ccc;border-radius:8px}
  .code{font-weight:700;letter-spacing:.18em}
  pre{white-space:pre-wrap;font:inherit;margin:0}
</style></head><body>
<h1>NovaMed — podsumowanie wizyty</h1>
<p class="muted">${esc(visit.clinic_name)} · ${formatDatePL(visit.appointment_datetime)}, ${formatTime(visit.appointment_datetime)} · ${esc(visit.doctor_name)}</p>
<div class="sec"><h2>Pacjent</h2><p>${esc(`${patient.first_name} ${patient.last_name}`)} · PESEL ${patient.pesel}</p></div>
${visit.notes ? `<div class="sec"><h2>Zgłoszony powód wizyty</h2><pre>${esc(visit.notes)}</pre></div>` : ''}
${noteHtml}
${others.length ? `<div class="sec"><h2>Wystawione dokumenty</h2>${others.map(d =>
      `<div class="doc"><strong>${KIND_LABEL[d.document_type]}</strong>${d.code ? ` · kod: <span class="code">${esc(d.code)}</span>` : ''}<br><span class="muted">${esc(d.details ?? '')}</span></div>`).join('')}</div>` : ''}
<p class="muted" style="margin-top:26px">Wydruk z systemu NovaMed · ${new Date().toLocaleString('pl-PL')}</p>
</body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 250)
  }

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={`Gabinet · ${formatDatePL(visit.appointment_datetime)}, ${formatTime(visit.appointment_datetime)} · ${visit.appointment_type === 'ONLINE' ? 'teleporada' : 'stacjonarna'}`}
          title={visit.patient_name ?? 'Wizyta'}
          action={<>
            {confirmed && visitToday && (
              <>
                <Button disabled={changeStatus.isPending} onClick={() => changeStatus.mutate('IN_PROGRESS')}><Play size={15} /> Rozpocznij wizytę</Button>
                <Button variant="ghost" onClick={() => setConfirm('NO_SHOW')}>Nie stawił się</Button>
              </>
            )}
            {confirmed && !visitToday && <StatusBadge status={visit.appointment_status} />}
            {inProgress && (
              <>
                {visit.appointment_type === 'ONLINE' && (
                  <Button variant="secondary" onClick={() => navigate(`/telewizyta/${id}`)}>
                    <Video size={15} /> Rozmowa wideo
                  </Button>
                )}
                <Button variant="secondary" disabled={changeStatus.isPending || saveDraft.isPending} onClick={pauseVisit}>
                  <Pause size={14} /> Wstrzymaj
                </Button>
                <Button disabled={changeStatus.isPending} onClick={() => unsavedNote ? setConfirm('COMPLETE_UNSAVED') : changeStatus.mutate('COMPLETED')}>
                  <Square size={14} /> Zakończ wizytę
                </Button>
              </>
            )}
            {paused && (
              <>
                <Button disabled={changeStatus.isPending} onClick={() => changeStatus.mutate('IN_PROGRESS')}>
                  <Play size={15} /> Wznów wizytę
                </Button>
                <Button variant="ghost" disabled={changeStatus.isPending} onClick={() => unsavedNote ? setConfirm('COMPLETE_UNSAVED') : changeStatus.mutate('COMPLETED')}>
                  <Square size={14} /> Zakończ
                </Button>
              </>
            )}
            {visit.appointment_status === 'NO_SHOW'
              && new Date(visit.appointment_datetime).toDateString() === new Date().toDateString() && (
              <Button disabled={changeStatus.isPending} onClick={() => changeStatus.mutate('IN_PROGRESS')}>
                <Play size={15} /> Jednak przyszedł — rozpocznij
              </Button>
            )}
            {!confirmed && !inProgress && !paused && <StatusBadge status={visit.appointment_status} />}
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
                {/* alergie — nad wszystkim innym (bezpieczeństwo przy recepcie) */}
                {patient.allergies ? (
                  <div className="mb-2 flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 ring-1 ring-red-200">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-600" />
                    <div>
                      <p className="text-xs font-extrabold tracking-wider text-red-700 uppercase">Alergie</p>
                      <p className="mt-0.5 text-sm font-bold text-red-900">{patient.allergies}</p>
                    </div>
                  </div>
                ) : (
                  <button onClick={openClinical} className="mb-2 flex w-full cursor-pointer items-center gap-1.5 rounded-xl bg-gray-50 px-3.5 py-2 text-xs font-bold text-gray-400 hover:bg-gray-100">
                    <AlertTriangle size={13} /> Alergie: nie odnotowano — kliknij, aby uzupełnić
                  </button>
                )}
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

                {(patient.chronic_diseases || patient.chronic_medications) && (
                  <div className="mt-1.5 space-y-1 rounded-xl bg-gray-50 px-3.5 py-2.5">
                    {patient.chronic_diseases && (
                      <p className="text-sm"><span className="text-xs font-extrabold tracking-wider text-gray-400 uppercase">Choroby przewlekłe: </span><span className="font-semibold text-gray-700">{patient.chronic_diseases}</span></p>
                    )}
                    {patient.chronic_medications && (
                      <p className="text-sm"><span className="text-xs font-extrabold tracking-wider text-gray-400 uppercase">Leki stałe: </span><span className="font-semibold text-gray-700">{patient.chronic_medications}</span></p>
                    )}
                  </div>
                )}
                <button onClick={openClinical} className="inline-flex cursor-pointer items-center gap-1 pt-1 text-xs font-extrabold text-primary hover:underline">
                  <ClipboardPen size={12} /> {patient.allergies || patient.chronic_diseases || patient.chronic_medications ? 'Edytuj dane kliniczne' : 'Dodaj alergie / choroby / leki'}
                </button>
              </div>
            ) : <p className="text-sm font-medium text-gray-400">Wczytywanie…</p>}
          </Tile>

          {/* nota z wizyty (encounter note): szkic edytowalny do podpisu, po podpisie
              zablokowana — zmiany tylko przez uzupełnienia (jak w realnych EHR) */}
          {signed ? (
            <Tile className="p-5" delay={100}>
              <TileHeader title={<span className="inline-flex items-center gap-1.5 text-emerald-700"><FileCheck2 size={13} /> Nota z wizyty — podpisana</span>} />
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-gray-400">
                <Lock size={11} /> {clinicalNote?.signed_by_name}
                {clinicalNote?.signed_at && ` · ${formatDatePL(clinicalNote.signed_at)}, ${formatTime(clinicalNote.signed_at)}`}
              </p>
              <p className="rounded-2xl bg-gray-50 px-4 py-3 text-sm leading-relaxed font-medium whitespace-pre-wrap text-gray-800">{clinicalNote?.content}</p>

              {(clinicalNote?.addenda.length ?? 0) > 0 && (
                <div className="mt-3 space-y-2">
                  {clinicalNote!.addenda.map((ad, i) => (
                    <div key={i} className="rounded-xl border-l-2 border-primary/40 bg-primary-soft/30 px-3.5 py-2.5">
                      <p className="text-[11px] font-extrabold tracking-wider text-primary/70 uppercase">
                        Uzupełnienie · {ad.author_name} · {formatDatePL(ad.created_at)}, {formatTime(ad.created_at)}
                      </p>
                      <p className="mt-0.5 text-sm font-medium whitespace-pre-wrap text-gray-800">{ad.content}</p>
                    </div>
                  ))}
                </div>
              )}

              {visit.doctor_id && (
                <div className="mt-3">
                  <textarea
                    className={cx(inputCls, 'h-16 py-2')} value={addendum}
                    onChange={e => setAddendum(e.target.value)}
                    placeholder="Dodaj uzupełnienie (np. wynik, który dotarł po wizycie)…"
                  />
                  <Button className="mt-2" size="sm" variant="secondary"
                    disabled={addAddendum.isPending || addendum.trim().length < 2} onClick={() => addAddendum.mutate()}>
                    <Plus size={14} /> {addAddendum.isPending ? 'Dodawanie…' : 'Dodaj uzupełnienie'}
                  </Button>
                </div>
              )}

              {(clinicalNote?.events.length ?? 0) > 0 && (
                <div className="mt-3 border-t border-gray-100 pt-2">
                  <button type="button" onClick={() => setRevOpen(o => !o)} aria-expanded={revOpen}
                    className="flex w-full cursor-pointer items-center justify-between rounded-xl px-1 py-1.5 text-left hover:bg-gray-50">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-gray-400 uppercase">
                      <History size={13} /> Historia zmian ({clinicalNote!.events.length})
                    </span>
                    <ChevronDown size={15} className={cx('text-gray-400 transition-transform', revOpen && 'rotate-180')} />
                  </button>
                  {revOpen && (
                    <ul className="mt-1 space-y-1">
                      {clinicalNote!.events.map((e, i) => (
                        <li key={i} className="flex flex-wrap items-center justify-between gap-1 rounded-lg bg-gray-50 px-3 py-1.5 text-xs">
                          <span className="font-bold text-gray-700">{NOTE_ACTION_LABEL[e.action] ?? e.action}</span>
                          <span className="font-medium text-gray-400">{e.actor_name} · {formatDatePL(e.created_at)}, {formatTime(e.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Tile>
          ) : active ? (
            <Tile className="p-5" delay={100}>
              <TileHeader title={<span className="inline-flex items-center gap-1.5"><ClipboardPen size={13} /> Nota z wizyty <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700 normal-case">szkic</span></span>} />
              {paused && (
                <p className="mb-3 flex items-center gap-1.5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-bold text-amber-800">
                  <Pause size={13} /> Wizyta wstrzymana — wypełnienia są zachowane. Kliknij „Wznów wizytę", aby kontynuować.
                </p>
              )}
              <div className="mb-3">
                <button type="button" onClick={() => setTemplatesOpen(o => !o)} aria-expanded={templatesOpen}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-extrabold text-gray-600 hover:bg-primary-soft hover:text-primary">
                  <ClipboardPen size={13} /> Gotowe szablony
                  <ChevronDown size={13} className={cx('transition-transform', templatesOpen && 'rotate-180')} />
                </button>
                {templatesOpen && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {NOTE_TEMPLATES.map(tpl => (
                      <button key={tpl.label} type="button"
                        onClick={() => { setNote({ wywiad: tpl.wywiad, badanie: tpl.badanie, zalecenia: tpl.zalecenia }); setTemplatesOpen(false) }}
                        className="cursor-pointer rounded-full bg-gray-100 px-3 py-1 text-xs font-extrabold text-gray-600 hover:bg-primary-soft hover:text-primary">
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {NOTE_SECTIONS.slice(0, 2).map(s => (
                  <Field key={s.key} label={s.label}>
                    <textarea className={cx(inputCls, s.tall ? 'h-20' : 'h-12', 'py-2')} value={note[s.key]}
                      onChange={e => setNote(n => ({ ...n, [s.key]: e.target.value }))} placeholder={s.placeholder} />
                  </Field>
                ))}
                <Field label="Rozpoznanie (ICD-10)" hint="trafia do noty i automatycznie do recept/skierowań">
                  <Typeahead id="icd10-gabinet" minLength={1} value={rozpoznanie} onChange={setRozpoznanie}
                    search={searchIcd10} placeholder="np. B02 albo półpasiec" />
                </Field>
                {NOTE_SECTIONS.slice(2).map(s => (
                  <Field key={s.key} label={s.label}>
                    <textarea className={cx(inputCls, s.tall ? 'h-20' : 'h-12', 'py-2')} value={note[s.key]}
                      onChange={e => setNote(n => ({ ...n, [s.key]: e.target.value }))} placeholder={s.placeholder} />
                  </Field>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={saveDraft.isPending || composed.length < 2} onClick={() => saveDraft.mutate()}>
                  {saveDraft.isPending ? 'Zapisywanie…' : 'Zapisz szkic'}
                </Button>
                <Button size="sm" variant="secondary" disabled={signNote.isPending || (composed.length < 2 && savedContent.length < 2)}
                  onClick={() => unsavedNote ? saveDraft.mutate(undefined, { onSuccess: () => signNote.mutate() }) : signNote.mutate()}>
                  <FileCheck2 size={14} /> Podpisz notę
                </Button>
                {noteSaved && <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><Check size={13} /> Zapisano</span>}
              </div>
              <p className="mt-2 text-xs font-medium text-gray-400">Szkic edytowalny do podpisu. Zakończenie wizyty podpisuje notę automatycznie.</p>
            </Tile>
          ) : confirmed ? (
            <Tile className="p-5" delay={100}>
              <p className="text-sm leading-relaxed font-medium text-gray-500">
                Nota i wystawianie dokumentów otworzą się po kliknięciu
                <span className="font-extrabold text-gray-900"> „Rozpocznij wizytę"</span> u góry.
                Do tego czasu możesz przejrzeć dane pacjenta i dokumentację.
              </p>
            </Tile>
          ) : null}

          {/* wystawianie dokumentów — przez cały czas trwania wizyty (też po podpisie noty) */}
          {active && patientId && (
            <Tile className="p-5" delay={140}>
              <TileHeader title="Wystaw dokument" />
              <WystawDokument patientId={patientId} appointmentId={id!} hideKinds={['NOTE']} icd10={rozpoznanie} allergies={patient?.allergies} />
            </Tile>
          )}
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
            title="Niezapisany szkic noty"
            onClose={() => setConfirm(null)}
            footer={<>
              <Button variant="ghost" onClick={() => { setConfirm(null); changeStatus.mutate('COMPLETED') }}>
                Zakończ bez zapisu
              </Button>
              <Button
                disabled={saveDraft.isPending}
                onClick={() => saveDraft.mutate(undefined, { onSuccess: () => { setConfirm(null); changeStatus.mutate('COMPLETED') } })}
              >
                <Check size={14} /> Zapisz i zakończ
              </Button>
            </>}
          >
            <p className="text-sm leading-relaxed font-medium text-gray-600">
              Masz zmiany w szkicie noty, które nie zostały zapisane. Przy zakończeniu wizyty nota zostanie podpisana — zapisz, żeby nie utracić tych zmian.
            </p>
          </Modal>
        )}

        {clinicalOpen && (
          <Modal
            overline={patient ? `${patient.first_name} ${patient.last_name}` : 'Pacjent'}
            title="Dane kliniczne pacjenta"
            onClose={() => setClinicalOpen(false)}
            footer={<>
              <Button variant="secondary" onClick={() => setClinicalOpen(false)}>Anuluj</Button>
              <Button disabled={saveClinical.isPending} onClick={() => saveClinical.mutate()}>
                <Check size={14} /> {saveClinical.isPending ? 'Zapisywanie…' : 'Zapisz'}
              </Button>
            </>}
          >
            <div className="space-y-3 pb-2">
              <Field label="Alergie" hint="np. penicylina (wysypka), pyłki traw — widoczne na czerwono przy recepcie">
                <textarea className={cx(inputCls, 'h-16 py-2')} value={clin.allergies}
                  onChange={e => setClin(c => ({ ...c, allergies: e.target.value }))}
                  placeholder="Brak znanych alergii — zostaw puste" />
              </Field>
              <Field label="Choroby przewlekłe">
                <textarea className={cx(inputCls, 'h-16 py-2')} value={clin.chronic_diseases}
                  onChange={e => setClin(c => ({ ...c, chronic_diseases: e.target.value }))}
                  placeholder="np. nadciśnienie, cukrzyca typu 2" />
              </Field>
              <Field label="Leki przyjmowane na stałe">
                <textarea className={cx(inputCls, 'h-16 py-2')} value={clin.chronic_medications}
                  onChange={e => setClin(c => ({ ...c, chronic_medications: e.target.value }))}
                  placeholder="np. ramipryl 10 mg, metformina 1000 mg 2×dz." />
              </Field>
            </div>
          </Modal>
        )}

        {/* dokumentacja: efekty TEJ wizyty na wierzchu, historia zwinięta
            (za dużo informacji w trakcie pracy = szum) */}
        <Tile className="p-5" delay={120}>
          {(active || visitDocs.length > 0 || signed) && (
            <div className="mb-5">
              <TileHeader
                title={<span className="inline-flex items-center gap-1.5 text-primary"><ClipboardPen size={13} /> Z tej wizyty</span>}
                action={(visitDocs.length > 0 || signed) && (
                  <Button size="sm" variant="ghost" onClick={printSummary}>
                    <Printer size={14} /> Drukuj podsumowanie
                  </Button>
                )}
              />
              {visitDocs.length > 0 ? (
                <DokumentyLista documents={visitDocs} onCancel={cancelDoc} />
              ) : (
                <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-3 text-sm font-medium text-gray-400">
                  Wystawione dokumenty (recepty, skierowania, wyniki) pojawią się tutaj od razu.
                </p>
              )}
            </div>
          )}

          {/* historia wizyt z notami — najważniejszy kontekst ciągłości leczenia */}
          {(history?.length ?? 0) > 0 && (
            <div className="mb-5">
              <TileHeader title={<span className="inline-flex items-center gap-1.5"><History size={13} /> Poprzednie wizyty <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-extrabold text-gray-500">{history!.length}</span></span>} />
              <ul className="space-y-1.5">
                {history!.map((h, i) => {
                  const open = openHist.has(i)
                  return (
                    <li key={h.appointment_id} className="rounded-2xl bg-gray-50">
                      <button type="button" aria-expanded={open}
                        onClick={() => toggleHist(i)}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-left">
                        <span className="min-w-0">
                          <span className="block text-sm font-extrabold text-gray-900">{formatDatePL(h.date)}, {formatTime(h.date)}</span>
                          <span className="block truncate text-xs font-semibold text-gray-500">
                            {h.doctor_name} · {h.appointment_type === 'ONLINE' ? 'teleporada' : 'stacjonarna'}
                            {h.note ? '' : ' · brak noty'}
                          </span>
                        </span>
                        <ChevronDown size={15} className={cx('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
                      </button>
                      {open && (
                        <div className="space-y-2 border-t border-gray-100 px-4 py-3">
                          {h.note ? (
                            <p className="text-sm leading-relaxed font-medium whitespace-pre-wrap text-gray-800">{h.note}</p>
                          ) : (
                            <p className="text-sm font-medium text-gray-400">Lekarz nie zostawił noty z tej wizyty.</p>
                          )}
                          {h.addenda.map((a, j) => (
                            <p key={j} className="border-l-2 border-primary/40 pl-3 text-sm font-medium whitespace-pre-wrap text-gray-700">
                              <span className="text-[11px] font-extrabold tracking-wider text-primary/70 uppercase">Uzupełnienie: </span>{a}
                            </p>
                          ))}
                          {h.documents.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {h.documents.map((d, j) => (
                                <span key={j} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-gray-600 tile-shadow">
                                  {d.label}{d.code ? ` · ${d.code}` : ''}
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
            </div>
          )}

          <button
            type="button"
            onClick={() => setHistOpen(o => !o)}
            aria-expanded={histOpen}
            className="flex w-full cursor-pointer items-center justify-between rounded-xl px-1 py-1.5 text-left hover:bg-gray-50"
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-gray-400 uppercase">
              <FolderOpen size={13} /> Wszystkie dokumenty
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-extrabold text-gray-500 normal-case">{historyDocs.length}</span>
            </span>
            <ChevronDown size={15} className={cx('text-gray-400 transition-transform', histOpen && 'rotate-180')} />
          </button>

          {histOpen && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filtr rodzaju dokumentu">
                {(['ALL', ...HIST_KINDS] as const).map(k => (
                  <button
                    key={k} type="button" role="radio" aria-checked={histFilter === k}
                    onClick={() => { setHistFilter(k); setHistLimit(8) }}
                    className={cx(
                      'cursor-pointer rounded-full px-3 py-1.5 text-[11px] font-extrabold transition-colors',
                      histFilter === k ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                    )}
                  >
                    {k === 'ALL' ? `Wszystkie (${historyDocs.length})` : `${KIND_LABEL[k]} (${histCount(k)})`}
                  </button>
                ))}
              </div>
              <div className="max-h-[60vh] overflow-y-auto pr-1">
                <DokumentyLista documents={histShown.slice(0, histLimit)} emptyHint="Brak dokumentów tego rodzaju." />
              </div>
              {histShown.length > histLimit && (
                <div className="text-center">
                  <Button size="sm" variant="ghost" onClick={() => setHistLimit(n => n + 12)}>
                    Pokaż więcej ({histShown.length - histLimit})
                  </Button>
                </div>
              )}
            </div>
          )}
        </Tile>
      </div>
    </div>
  )
}
