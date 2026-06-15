import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Pencil, Search, ShieldCheck, Users } from 'lucide-react'
import { Badge, Button, EmptyState, Field, Loading, Modal, PageHeader, Tile, cx, inputCls } from '../../ui'
import { api, ApiError } from '../../lib/api'
import { ClinicSelect, useClinicSelection } from '../../components/ClinicPicker'

interface PatientRow {
  patient_id: string
  first_name: string
  last_name: string
  pesel: string
  insurance_status: boolean
}

export function PacjenciPlacowki() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
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

  // UC-PP3: edycja danych kontaktowych pacjenta
  const [editFor, setEditFor] = useState<PatientRow | null>(null)
  const [editPhone, setEditPhone] = useState('')
  const saveContact = useMutation({
    mutationFn: () => api(`/patients/${editFor!.patient_id}/contact`, {
      method: 'PATCH', body: { phone_number: editPhone },
    }),
    onSuccess: () => { setError(null); setEditFor(null); void queryClient.invalidateQueries({ queryKey: ['clinic-patients'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać danych.'),
  })

  const filtered = (patients ?? []).filter(p =>
    `${p.first_name} ${p.last_name}${p.pesel}`.toLowerCase().includes(q.toLowerCase()))

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
                <Search size={15} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400" />
                <input className={cx(inputCls, 'w-64 pl-10')} placeholder="Nazwisko lub PESEL…" value={q} onChange={e => setQ(e.target.value)} />
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
                {['Pacjent', 'PESEL', 'Status eWUŚ', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-extrabold tracking-wider text-gray-400 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.patient_id} className="hover:bg-gray-50">
                  <td className="border-t border-gray-100 px-4 py-3.5 font-extrabold text-gray-900">{p.first_name} {p.last_name}</td>
                  <td className="border-t border-gray-100 px-4 py-3.5 font-medium text-gray-500">{p.pesel}</td>
                  <td className="border-t border-gray-100 px-4 py-3.5">
                    {p.insurance_status
                      ? <Badge tone="success">ubezpieczony</Badge>
                      : <Badge tone="warn">brak potwierdzenia</Badge>}
                  </td>
                  <td className="border-t border-gray-100 px-4 py-3.5 text-right">
                    <div className="flex justify-end gap-2">
                      <Link to={`/pacjent/${p.patient_id}`} className="inline-flex h-8 items-center gap-1 rounded-full px-4 text-xs font-bold text-gray-500 hover:bg-gray-100 hover:text-gray-900">
                        <FolderOpen size={13} /> Kartoteka
                      </Link>
                      <Button size="sm" variant="ghost" onClick={() => { setEditFor(p); setEditPhone('') }}>
                        <Pencil size={13} /> Kontakt
                      </Button>
                      <Button size="sm" variant="secondary" disabled={verify.isPending}
                        onClick={() => verify.mutate(p.patient_id)}>
                        <ShieldCheck size={14} /> Weryfikuj eWUŚ
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tile>

      {editFor && (
        <Modal
          overline={`${editFor.first_name} ${editFor.last_name} · PESEL ${editFor.pesel}`}
          title="Dane kontaktowe"
          onClose={() => setEditFor(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setEditFor(null)}>Anuluj</Button>
            <Button disabled={saveContact.isPending || editPhone.trim().length < 7}
              onClick={() => saveContact.mutate()}>
              {saveContact.isPending ? 'Zapisywanie…' : 'Zapisz'}
            </Button>
          </>}
        >
          <div className="pb-2">
            <Field label="Telefon" hint="na ten numer pójdą SMS-y z przypomnieniami">
              <input className={inputCls} value={editPhone} placeholder="601 234 567"
                onChange={e => setEditPhone(e.target.value)} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
