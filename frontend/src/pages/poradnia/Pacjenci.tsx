// Pacjenci placówki (recepcja) — lista do szybkiego odnalezienia + KLIKALNY rząd
// otwierający modal szczegółów: kiedy pacjent do nas wpada, kiedy był ostatnio,
// dane kontaktowe (edycja inline), eWUŚ, skróty do umówienia i pełnej kartoteki.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, CalendarClock, Check, ChevronRight, Clock, FolderOpen, MapPin, Pencil, Phone, Search, ShieldCheck, Users, Video, X } from 'lucide-react'
import { Badge, Button, EmptyState, Loading, Modal, PageHeader, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { formatDatePL, formatTime } from '../../lib/format'
import { birthFromPesel } from '../../lib/pesel'
import { confirm } from '../../lib/confirm'
import { pushToast } from '../../lib/toast'
import type { AppointmentOut } from '../../lib/types'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'
import { StaffReschedule } from '../../components/StaffReschedule'

interface PatientRow {
  patient_id: string
  first_name: string
  last_name: string
  pesel: string
  insurance_status: boolean
  phone_number: string | null
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const UPCOMING = ['CONFIRMED', 'IN_PROGRESS', 'PAUSED']
const ageOf = (iso: string) => { const b = new Date(iso), t = new Date(); let a = t.getFullYear() - b.getFullYear(); const m = t.getMonth() - b.getMonth(); if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--; return a }

export function PacjenciPlacowki() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<PatientRow | null>(null)
  const { clinics, clinic, setClinicId } = useClinicSelection()

  const { data: patients } = useQuery({
    queryKey: ['clinic-patients', clinic?.clinic_id],
    queryFn: () => api<PatientRow[]>(`/clinics/${clinic!.clinic_id}/patients`),
    enabled: !!clinic,
  })

  const verify = useMutation({
    mutationFn: (patientId: string) => api(`/patients/${patientId}/verify-insurance`, { method: 'POST' }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['clinic-patients'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Weryfikacja eWUŚ nie powiodła się.'),
  })
  const saveContact = useMutation({
    mutationFn: ({ id, phone }: { id: string; phone: string }) => api(`/patients/${id}/contact`, { method: 'PATCH', body: { phone_number: phone } }),
    onSuccess: (_d, v) => { setError(null); setDetail(p => (p && p.patient_id === v.id ? { ...p, phone_number: v.phone } : p)); void queryClient.invalidateQueries({ queryKey: ['clinic-patients'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać danych.'),
  })

  const needle = fold(q.trim())
  const filtered = (patients ?? []).filter(p =>
    !needle || fold(`${p.first_name} ${p.last_name} ${p.pesel} ${p.phone_number ?? ''}`).includes(needle))

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={clinic?.clinic_name ?? '…'}
          title="Pacjenci placówki"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />
              <div className="relative">
                <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-500" />
                <input className={cx(inputCls, 'w-72 pl-10')} autoFocus placeholder="Nazwisko, PESEL lub telefon…" value={q} onChange={e => setQ(e.target.value)} />
              </div>
            </div>
          }
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <Tile className="overflow-hidden p-0" delay={60}>
        {patients === undefined ? <Loading /> : filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={28} strokeWidth={1.5} />}
            title={q ? 'Brak wyników' : 'Brak pacjentów przypisanych do placówki'}
            hint={q ? 'Zmień kryteria wyszukiwania.' : 'Pacjenci są przypisywani do placówki przy rejestracji wizyty.'}
          />
        ) : (
          <table className="w-full text-sm [font-variant-numeric:tabular-nums]">
            <thead>
              <tr>
                {['Pacjent', 'PESEL', 'Telefon', 'Status eWUŚ', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-extrabold tracking-wider text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.patient_id} onClick={() => { setError(null); setDetail(p) }}
                  className="cursor-pointer hover:bg-primary-soft/40">
                  <td className="border-t border-gray-100 px-4 py-3.5 font-extrabold text-gray-900">{p.first_name} {p.last_name}</td>
                  <td className="border-t border-gray-100 px-4 py-3.5 font-medium text-gray-500">{p.pesel}</td>
                  <td className="border-t border-gray-100 px-4 py-3.5 font-medium text-gray-500">{p.phone_number ?? <span className="text-gray-300">—</span>}</td>
                  <td className="border-t border-gray-100 px-4 py-3.5">
                    {p.insurance_status
                      ? <Badge tone="success">ubezpieczony</Badge>
                      : <Badge tone="warn">brak potwierdzenia</Badge>}
                  </td>
                  <td className="border-t border-gray-100 px-4 py-3.5 text-right">
                    <ChevronRight size={16} className="ml-auto text-gray-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tile>

      {detail && (
        <PatientDetail patient={detail} onClose={() => setDetail(null)}
          onVerify={() => verify.mutate(detail.patient_id)} verifying={verify.isPending}
          onSaveContact={(phone) => saveContact.mutate({ id: detail.patient_id, phone })} savingContact={saveContact.isPending} />
      )}
    </div>
  )
}

// ---- modal szczegółów pacjenta ----
function ApptLine({ a, tone, onReschedule, onCancel, busy }: {
  a: AppointmentOut; tone?: 'primary'; onReschedule?: () => void; onCancel?: () => void; busy?: boolean
}) {
  const online = a.appointment_type === 'ONLINE'
  return (
    <div className={cx('rounded-2xl px-4 py-3', tone === 'primary' ? 'bg-primary-soft' : 'bg-gray-50')}>
      <div className="flex items-center gap-2">
        <span className={cx('shrink-0 text-sm font-extrabold [font-variant-numeric:tabular-nums]', tone === 'primary' ? 'text-primary' : 'text-gray-900')}>
          {formatDatePL(a.appointment_datetime)}<span className="ml-1">{formatTime(a.appointment_datetime)}</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{a.doctor_id ? a.doctor_name : (a.service_name ?? 'Pracownia')}</span>
      </div>
      {/* CO — usługa/typ wizyty */}
      {a.doctor_id && a.service_name && <p className="mt-0.5 truncate text-xs font-medium text-gray-500">{a.service_name}</p>}
      {/* GDZIE — placówka + adres (albo teleporada) */}
      <p className="mt-0.5 flex items-start gap-1 text-xs font-medium text-gray-500">
        {online
          ? <><Video size={12} className="mt-0.5 shrink-0" /> Teleporada (wideo)</>
          : <><MapPin size={12} className="mt-0.5 shrink-0" /> <span><span className="font-bold text-gray-700">{a.clinic_name}</span>{a.clinic_address ? `, ${a.clinic_address}` : ''}</span></>}
      </p>
      {(onReschedule || onCancel) && (
        <div className="mt-2 flex gap-2">
          {onReschedule && <button onClick={onReschedule} disabled={busy} className="cursor-pointer rounded-full bg-surface px-3 py-1 text-xs font-extrabold text-gray-700 tile-shadow hover:text-primary disabled:opacity-50">Przełóż</button>}
          {onCancel && <button onClick={onCancel} disabled={busy} className="cursor-pointer rounded-full bg-surface px-3 py-1 text-xs font-extrabold text-red-600 tile-shadow hover:bg-red-50 disabled:opacity-50">Odwołaj</button>}
        </div>
      )}
    </div>
  )
}

function PatientDetail({ patient, onClose, onVerify, verifying, onSaveContact, savingContact }: {
  patient: PatientRow
  onClose: () => void
  onVerify: () => void
  verifying: boolean
  onSaveContact: (phone: string) => void
  savingContact: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState(patient.phone_number ?? '')
  const { data: appts } = useQuery({
    queryKey: ['patient-appts', patient.patient_id],
    queryFn: () => api<AppointmentOut[]>(`/patients/${patient.patient_id}/appointments`),
  })
  const qc = useQueryClient()
  const [rescheduleFor, setRescheduleFor] = useState<AppointmentOut | null>(null)
  const refreshAppts = () => {
    void qc.invalidateQueries({ queryKey: ['patient-appts', patient.patient_id] })
    void qc.invalidateQueries({ queryKey: ['clinic-slots'] })
    void qc.invalidateQueries({ queryKey: ['clinic-day'] })
  }
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/appointments/${id}/cancel`, { method: 'POST' }),
    onSuccess: refreshAppts,
    onError: (e) => pushToast(e instanceof ApiError ? e.message : 'Nie udało się odwołać wizyty.', 'error'),
  })
  const doCancel = async (a: AppointmentOut) => {
    if (await confirm({ title: 'Odwołać wizytę?', message: `${formatDatePL(a.appointment_datetime)}, ${formatTime(a.appointment_datetime)} — ${a.doctor_name}. Pacjent dostanie powiadomienie.`, tone: 'danger', confirmLabel: 'Odwołaj' }))
      cancel.mutate(a.appointment_id)
  }
  const birth = birthFromPesel(patient.pesel)
  const list = appts ?? []
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
  // najbliższa = pierwsza przyszła potwierdzona; ostatnia = ostatnia odbyta
  const upcoming = list
    .filter(a => UPCOMING.includes(a.appointment_status) && new Date(a.appointment_datetime) >= startToday)
    .sort((x, y) => x.appointment_datetime.localeCompare(y.appointment_datetime))
  const next = upcoming[0]
  const completed = list.filter(a => a.appointment_status === 'COMPLETED')  // /appointments zwraca malejąco
  const last = completed[0]
  const totalVisits = completed.length

  return (
    <>
    <Modal title={`${patient.first_name} ${patient.last_name}`}
      overline={`PESEL ${patient.pesel}${birth ? ` · ${ageOf(birth)} l.` : ''}`}
      onClose={onClose} wide
      footer={<>
        <Link to={`/pacjent/${patient.patient_id}`}><Button variant="ghost"><FolderOpen size={15} /> Pełna kartoteka</Button></Link>
        <Link to="/umow" state={{ patient: { patient_id: patient.patient_id, name: `${patient.first_name} ${patient.last_name}`, pesel: patient.pesel } }}>
          <Button><CalendarCheck size={16} /> Umów wizytę</Button>
        </Link>
      </>}>
      <div className="space-y-3">
        {/* dane kontaktowe + eWUŚ */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-gray-50 px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm">
            <Phone size={14} className="text-gray-400" />
            {editing ? (
              <span className="flex items-center gap-1.5">
                <input className={cx(inputCls, 'h-8 w-40')} value={phone} placeholder="601 234 567" onChange={e => setPhone(e.target.value)} />
                <Button size="sm" disabled={savingContact || phone.trim().length < 7} onClick={() => { onSaveContact(phone.trim()); setEditing(false) }}><Check size={13} /></Button>
                <button onClick={() => { setEditing(false); setPhone(patient.phone_number ?? '') }} className="cursor-pointer rounded-full p-1 text-gray-400 hover:bg-gray-200"><X size={14} /></button>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-bold text-gray-900">
                {patient.phone_number ?? <span className="font-medium text-gray-500">brak numeru</span>}
                <button onClick={() => setEditing(true)} className="cursor-pointer text-gray-400 hover:text-primary"><Pencil size={12} /></button>
              </span>
            )}
          </span>
          <span className="flex items-center gap-2 text-sm">
            {patient.insurance_status ? <Badge tone="success">eWUŚ: ubezpieczony</Badge> : <Badge tone="warn">eWUŚ: brak potwierdzenia</Badge>}
            <Button size="sm" variant="ghost" disabled={verifying} onClick={onVerify}><ShieldCheck size={14} /> {verifying ? 'Sprawdzam…' : 'Sprawdź'}</Button>
          </span>
        </div>

        {/* kiedy do nas wpada */}
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-extrabold tracking-wide text-gray-500 uppercase"><CalendarClock size={13} /> Najbliższa wizyta</p>
          {appts === undefined ? <p className="px-1 text-sm text-gray-400">Wczytywanie…</p>
            : next ? <ApptLine a={next} tone="primary" busy={cancel.isPending} onReschedule={() => setRescheduleFor(next)} onCancel={() => void doCancel(next)} />
              : <p className="rounded-2xl bg-gray-50 px-4 py-3 text-sm font-medium text-gray-500">Brak nadchodzących wizyt.</p>}
          {upcoming.length > 1 && (
            <div className="mt-1.5 space-y-1.5">
              {upcoming.slice(1, 3).map(a => <ApptLine key={a.appointment_id} a={a} busy={cancel.isPending} onReschedule={() => setRescheduleFor(a)} onCancel={() => void doCancel(a)} />)}
              {upcoming.length > 3 && <p className="px-1 text-xs font-semibold text-gray-400">+ {upcoming.length - 3} kolejnych</p>}
            </div>
          )}
        </div>

        {/* kiedy był ostatnio */}
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-extrabold tracking-wide text-gray-500 uppercase">
            <Clock size={13} /> Ostatnia wizyta{totalVisits > 0 ? ` · ${totalVisits} odbytych` : ''}
          </p>
          {appts === undefined ? <p className="px-1 text-sm text-gray-400">Wczytywanie…</p>
            : last ? <ApptLine a={last} />
              : <p className="rounded-2xl bg-gray-50 px-4 py-3 text-sm font-medium text-gray-500">Pacjent nie był jeszcze na żadnej wizycie.</p>}
        </div>
      </div>
    </Modal>
    {rescheduleFor && (
      <StaffReschedule visit={rescheduleFor} onClose={() => setRescheduleFor(null)}
        onDone={() => { setRescheduleFor(null); refreshAppts() }} />
    )}
    </>
  )
}
