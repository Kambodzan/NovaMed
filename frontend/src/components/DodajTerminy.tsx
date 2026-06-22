// Modal dodawania wolnych terminów (slotów) lekarza / badań pracowni. Używany w
// Grafiku (kierownik). Zakres Od–Do generuje sloty co krok siatki (czas usługi →
// długość wizyty lekarza → siatka placówki), z opcją powtarzania tygodniowego.
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button, Field, Modal, cx, inputCls } from '../ui'
import { Select } from './Select'
import { TimePicker } from './TimePicker'
import { DatePicker } from './DatePicker'
import { type ServiceOut } from './ServicesManager'
import { api, ApiError } from '../lib/api'

interface DoctorRow { doctor_id: string; name: string; specializations: string[]; slot_duration_min: number | null; room: string | null }

// generuje godziny startu slotów od „from" (włącznie) do „to" (wyłącznie) co `step` min;
// gdy zakres pusty/odwrotny → pojedynczy slot o godzinie „from"
const slotTimes = (from: string, to: string, step: number): string[] => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const min = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
  const a = min(from), b = min(to)
  if (b <= a || !step) return [from]
  const out: string[] = []
  for (let m = a; m < b; m += step) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  return out
}

export function DodajTerminy({ clinicId, defaultDay, interval, defaultDoctorId, onClose, onAdded }: {
  clinicId: string; defaultDay: string; interval: number; defaultDoctorId?: string; onClose: () => void; onAdded: () => void
}) {
  const [form, setForm] = useState({
    kind: 'visit', service: '', service_id: '', doctor_id: defaultDoctorId ?? '', date: defaultDay, from: '09:00', to: '14:00',
    modality: 'STATIONARY', price: '', weeks: '1',
  })
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const { data: doctors } = useQuery({
    queryKey: ['clinic-doctors', clinicId],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinicId}/doctors`),
  })
  const { data: services } = useQuery({
    queryKey: ['clinic-services', clinicId],
    queryFn: () => api<ServiceOut[]>(`/clinics/${clinicId}/services`),
  })
  const doctorId = form.doctor_id || String(doctors?.[0]?.doctor_id ?? '')
  const selectedDoctor = doctors?.find(d => String(d.doctor_id) === doctorId)
  // usługi, które wykonuje wybrany lekarz (typy wizyt z katalogu)
  const docServices = (services ?? []).filter(s => s.doctor_ids.includes(doctorId))
  const pickedService = docServices.find(s => s.service_id === form.service_id) ?? null
  // krok siatki: czas usługi → długość wizyty lekarza → siatka placówki
  const effInterval = form.kind === 'visit'
    ? (pickedService?.duration_min ?? selectedDoctor?.slot_duration_min ?? interval)
    : interval
  // zakres Od–Do → wszystkie sloty dnia co krok siatki; × powtarzanie tygodniowe
  const dayTimes = slotTimes(form.from, form.to, effInterval)
  const weeks = Math.max(1, Number(form.weeks) || 1)
  const totalSlots = dayTimes.length * weeks
  // badanie pracowniane oraz usługa bez teleporady (np. echo serca) → tylko stacjonarnie
  const stationaryOnly = form.kind === 'exam' || (!!pickedService && !pickedService.allow_online)
  const effModality = stationaryOnly ? 'STATIONARY_ONLY' : form.modality

  const add = useMutation({
    mutationFn: () => {
      const pad = (n: number) => String(n).padStart(2, '0')
      const datetimes: string[] = []
      for (let w = 0; w < weeks; w++) {
        for (const t of dayTimes) {
          const d = new Date(`${form.date}T${t}:00`); d.setDate(d.getDate() + w * 7)
          datetimes.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${t}:00`)
        }
      }
      return api(`/clinics/${clinicId}/slots`, {
        method: 'POST',
        body: {
          doctor_id: form.kind === 'visit' ? doctorId : null,
          // usługa z katalogu: nazwa/cena/czas/skierowanie bierze backend z usługi
          service_id: form.kind === 'visit' && form.service_id ? form.service_id : null,
          service_name: form.kind === 'exam' ? form.service.trim() : null,
          datetimes,
          appointment_type: effModality === 'ONLINE' ? 'ONLINE' : 'STATIONARY',
          allow_online: effModality !== 'STATIONARY_ONLY',
          // cena ręczna TYLKO dla badań pracownianych; wizyty są NFZ (zwykła) albo
          // mają cenę z usługi katalogowej
          price: form.kind === 'exam' && form.price ? Number(form.price) : null,
        },
      })
    },
    onSuccess: () => {
      setError(null)
      setOk(`Dodano ${totalSlots} ${totalSlots === 1 ? 'termin' : 'terminów'}` +
        (weeks > 1 ? ` (${dayTimes.length}/dzień × ${weeks} tyg.).` : ` (${form.from}–${form.to}).`))
      onAdded()
    },
    onError: (e) => { setOk(null); setError(e instanceof ApiError ? e.message : 'Nie udało się dodać terminu.') },
  })

  return (
    <Modal title="Dodaj terminy" overline="nowe wolne sloty w grafiku lekarza / pracowni" onClose={onClose} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Zamknij</Button>
        <Button disabled={add.isPending || (form.kind === 'visit' && !doctorId) || totalSlots < 1 || totalSlots > 400}
          onClick={() => add.mutate()}><Plus size={15} /> Dodaj {totalSlots > 1 ? `(${totalSlots})` : ''}</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Rodzaj">
          <Select value={form.kind} onChange={v => setForm(f => ({ ...f, kind: v }))}
            options={[{ value: 'visit', label: 'wizyta lekarska' }, { value: 'exam', label: 'badanie (pracownia)' }]} />
        </Field>
        {form.kind === 'visit' ? (
          <>
          <Field label="Lekarz">
            <Select value={doctorId} onChange={v => setForm(f => ({ ...f, doctor_id: v, service_id: '' }))}
              options={(doctors ?? []).map(d => ({ value: String(d.doctor_id), label: d.name, hint: d.specializations.join(' · ') || undefined }))} />
          </Field>
          <Field label="Usługa (typ wizyty)" hint={docServices.length === 0 ? 'lekarz nie ma przypiętych usług — zwykła wizyta NFZ' : 'czas i cena z usługi'}>
            <Select value={form.service_id} onChange={v => setForm(f => ({ ...f, service_id: v }))}
              options={[{ value: '', label: 'Zwykła wizyta (NFZ)' },
                ...docServices.map(s => ({ value: s.service_id, label: s.name, hint: `${s.duration_min} min · ${s.price != null ? `${s.price} zł` : 'NFZ'}` }))]} />
          </Field>
          </>
        ) : (
          <Field label="Badanie" hint="bez ceny = NFZ (wymaga skierowania); z ceną = prywatne">
            <input className={inputCls} minLength={2} value={form.service} placeholder="np. RTG klatki piersiowej"
              onChange={e => setForm(f => ({ ...f, service: e.target.value }))} />
          </Field>
        )}
        <Field label="Data"><DatePicker value={form.date} min={new Date().toISOString().slice(0, 10)} onChange={v => setForm(f => ({ ...f, date: v }))} /></Field>
        <Field label="Od" hint={form.kind === 'visit' && selectedDoctor?.slot_duration_min ? `co ${effInterval} min (lekarz)` : `co ${effInterval} min`}>
          <TimePicker value={form.from} stepMin={effInterval} onChange={v => setForm(f => ({ ...f, from: v }))} />
        </Field>
        <Field label="Do" hint={`wygeneruje ${dayTimes.length} ${dayTimes.length === 1 ? 'termin' : 'terminów'}/dzień`}>
          <TimePicker value={form.to} stepMin={effInterval} onChange={v => setForm(f => ({ ...f, to: v }))} />
        </Field>
        <Field label="Forma" hint={stationaryOnly ? (form.kind === 'exam' ? 'badanie — tylko w placówce' : 'ta usługa nie ma teleporady') : undefined}>
          {stationaryOnly ? (
            <input className={cx(inputCls, 'text-gray-500')} value="stacjonarna" disabled readOnly />
          ) : (
            <Select value={form.modality} onChange={v => setForm(f => ({ ...f, modality: v }))}
              options={[
                { value: 'STATIONARY', label: 'stacjonarna (z opcją teleporady)' },
                { value: 'STATIONARY_ONLY', label: 'stacjonarna (tylko)' },
                { value: 'ONLINE', label: 'teleporada' },
              ]} />
          )}
        </Field>
        {form.kind === 'exam' && (
          <Field label="Cena [zł]" hint="puste = NFZ (wymaga skierowania)">
            <input type="number" min="0" step="10" className={inputCls} value={form.price} placeholder="—" onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
          </Field>
        )}
        <Field label="Powtarzanie">
          <Select value={form.weeks} onChange={v => setForm(f => ({ ...f, weeks: v }))}
            options={[{ value: '1', label: 'jednorazowo' }, ...[2, 3, 4, 6, 8, 12].map(n => ({ value: String(n), label: `co tydzień ×${n}` }))]} />
        </Field>
      </div>
      {totalSlots > 400 && <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-bold text-amber-800">Za dużo terminów naraz ({totalSlots}) — zawęź zakres godzin albo powtarzanie (max 400).</p>}
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      {ok && <p className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-700">{ok}</p>}
    </Modal>
  )
}
