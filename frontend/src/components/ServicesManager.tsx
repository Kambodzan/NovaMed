// Zarządzanie katalogiem usług placówki (typy wizyt/przyjęć): kierownik/admin
// tworzy usługi z czasem i ceną i przypina je lekarzom. Reużywane w Panelu Poradni
// i Panelu Admina → Placówki.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Field, Modal, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'

export interface ServiceOut {
  service_id: string
  name: string
  specialization: string | null
  duration_min: number
  price: number | null
  referral_required: boolean
  description: string | null
  active: boolean
  doctor_ids: string[]
}
interface DoctorRow { doctor_id: string; name: string; specializations: string[] }

export function ServicesManager({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ServiceOut | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: services } = useQuery({
    queryKey: ['clinic-services', clinicId],
    queryFn: () => api<ServiceOut[]>(`/clinics/${clinicId}/services`),
  })
  const { data: doctors } = useQuery({
    queryKey: ['clinic-doctors', clinicId],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinicId}/doctors`),
  })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['clinic-services', clinicId] })

  const setDoctors = useMutation({
    mutationFn: ({ id, ids }: { id: string; ids: string[] }) =>
      api(`/clinics/${clinicId}/services/${id}/doctors`, { method: 'PUT', body: { doctor_ids: ids } }),
    onSuccess: () => { setError(null); refresh() },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się przypisać lekarzy.'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/clinics/${clinicId}/services/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setError(null); refresh() },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się wycofać usługi.'),
  })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-extrabold text-gray-900">Usługi (typy wizyt)</p>
        <Button size="sm" variant="secondary" onClick={() => setEditing('new')}><Plus size={14} /> Dodaj usługę</Button>
      </div>
      <p className="mb-3 text-xs font-medium text-gray-500">
        Każda usługa ma własny czas i cenę; przypisz ją lekarzom, którzy ją wykonują. Pakiet = usługa z łączną ceną.
      </p>

      {error && <p className="mb-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      {!services || services.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm font-medium text-gray-500">
          Brak usług — dodaj pierwszą (np. „Konsultacja internistyczna", „USG jamy brzusznej").
        </p>
      ) : (
        <div className="space-y-2">
          {services.map(s => (
            <div key={s.service_id} className="rounded-2xl bg-gray-50 p-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-900">{s.name}</p>
                  <p className="text-xs font-semibold text-gray-500">
                    {s.duration_min} min · <span className={cx('font-extrabold', s.price != null ? 'text-gray-900' : 'text-emerald-700')}>{s.price != null ? `${s.price} zł` : 'NFZ'}</span>
                    {s.specialization ? ` · ${s.specialization}` : ''}{s.referral_required ? ' · wymaga skierowania' : ''}
                  </p>
                </div>
                <button onClick={() => setEditing(s)} aria-label="Edytuj" className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-primary"><Pencil size={14} /></button>
                <button onClick={() => remove.mutate(s.service_id)} aria-label="Wycofaj" className="cursor-pointer rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
              {doctors && doctors.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {doctors.map(d => {
                    const on = s.doctor_ids.includes(d.doctor_id)
                    return (
                      <button key={d.doctor_id} disabled={setDoctors.isPending}
                        onClick={() => setDoctors.mutate({ id: s.service_id, ids: on ? s.doctor_ids.filter(x => x !== d.doctor_id) : [...s.doctor_ids, d.doctor_id] })}
                        className={cx('cursor-pointer rounded-full px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-50',
                          on ? 'bg-primary text-white' : 'bg-white text-gray-500 tile-shadow hover:text-primary')}>
                        {d.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ServiceForm clinicId={clinicId} service={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />
      )}
    </div>
  )
}

function ServiceForm({ clinicId, service, onClose, onSaved }: {
  clinicId: string; service: ServiceOut | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: service?.name ?? '',
    specialization: service?.specialization ?? '',
    duration_min: String(service?.duration_min ?? 20),
    price: service?.price != null ? String(service.price) : '',
    referral_required: service?.referral_required ?? false,
    description: service?.description ?? '',
  })
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(), specialization: form.specialization.trim() || null,
        duration_min: Number(form.duration_min), price: form.price ? Number(form.price) : null,
        referral_required: form.referral_required, description: form.description.trim() || null,
      }
      return service
        ? api(`/clinics/${clinicId}/services/${service.service_id}`, { method: 'PATCH', body })
        : api(`/clinics/${clinicId}/services`, { method: 'POST', body })
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać usługi.'),
  })

  return (
    <Modal title={service ? 'Edytuj usługę' : 'Nowa usługa'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Anuluj</Button>
        <Button disabled={save.isPending || !form.name.trim()} onClick={() => save.mutate()}>Zapisz</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nazwa" hint="np. Konsultacja kardiologiczna + echo serca (pakiet)">
          <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Specjalizacja (opcjonalnie)" hint="do filtrowania w wyszukiwarce">
          <input className={inputCls} value={form.specialization} onChange={e => setForm(f => ({ ...f, specialization: e.target.value }))} />
        </Field>
        <Field label="Czas [min]" hint="krok siatki terminów">
          <input type="number" min="5" max="240" step="5" className={inputCls} value={form.duration_min} onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))} />
        </Field>
        <Field label="Cena [zł]" hint="puste = NFZ/bezpłatna">
          <input type="number" min="0" step="10" className={inputCls} value={form.price} placeholder="—" onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
        </Field>
        <Field label="Opis (opcjonalnie)" hint="np. składniki pakietu">
          <textarea className={cx(inputCls, 'h-16 py-2 sm:col-span-2')} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </Field>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-2xl bg-gray-50 px-4 py-2.5">
        <input type="checkbox" className="h-4 w-4 accent-(--color-primary)" checked={form.referral_required}
          onChange={e => setForm(f => ({ ...f, referral_required: e.target.checked }))} />
        <span className="text-sm font-semibold text-gray-700">Wymaga skierowania</span>
      </label>
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
    </Modal>
  )
}
