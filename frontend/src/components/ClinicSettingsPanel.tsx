// Panel konfiguracji placówki — wspólny dla Panelu Admina (dowolna placówka sieci)
// i Panelu Poradni (placówka kierownika). Ustawienia (siatka/przypomnienia/
// wyprzedzenie) + długość wizyty i gabinet per lekarz + katalog usług.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Tile, inputCls } from '../ui'
import { Select } from './Select'
import { ServicesManager } from './ServicesManager'
import type { ClinicLite } from './ClinicPicker'
import { api, ApiError } from '../lib/api'

interface DoctorRow { doctor_id: string; name: string; specializations: string[]; slot_duration_min: number | null; room: string | null }

export function ClinicSettingsPanel({ clinic }: { clinic: ClinicLite }) {
  const queryClient = useQueryClient()
  const [intervalMin, setIntervalMin] = useState(String(clinic.slot_interval_min))
  const [noticeHours, setNoticeHours] = useState(String(clinic.earlier_notice_min_hours))
  const [reminderMode, setReminderMode] = useState<string>(clinic.reminder_mode)
  const [confirmHours, setConfirmHours] = useState(String(clinic.confirmation_hours))
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => api(`/clinics/${clinic.clinic_id}/settings`, {
      method: 'PATCH',
      body: { slot_interval_min: Number(intervalMin), earlier_notice_min_hours: Number(noticeHours), reminder_mode: reminderMode, confirmation_hours: Number(confirmHours) },
    }),
    onSuccess: () => { setError(null); setOk('Zapisano ustawienia placówki.'); void queryClient.invalidateQueries({ queryKey: ['clinics'] }) },
    onError: (e) => { setOk(null); setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać ustawień.') },
  })

  const { data: docs } = useQuery({
    queryKey: ['clinic-doctors', clinic.clinic_id],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinic.clinic_id}/doctors`),
  })
  const setLen = useMutation({
    mutationFn: ({ id, val }: { id: string; val: number | null }) =>
      api(`/clinics/${clinic.clinic_id}/doctors/${id}/visit-length`, { method: 'PATCH', body: { slot_duration_min: val } }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['clinic-doctors', clinic.clinic_id] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać długości wizyty.'),
  })
  const setRoom = useMutation({
    mutationFn: ({ id, room }: { id: string; room: string | null }) =>
      api(`/clinics/${clinic.clinic_id}/doctors/${id}/room`, { method: 'PATCH', body: { room } }),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['clinic-doctors', clinic.clinic_id] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać gabinetu.'),
  })

  return (
    <>
    <Tile className="p-5">
      <p className="mb-3 text-sm font-extrabold text-gray-900">Ustawienia placówki</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Siatka terminów [min]" hint="co ile minut sloty (domyślne dla lekarzy bez własnej długości)">
          <Select value={intervalMin} onChange={setIntervalMin} options={[5, 10, 15, 20, 30, 60].map(n => ({ value: String(n), label: `${n} min` }))} />
        </Field>
        <Field label="Min. wyprzedzenie [h]" hint="powiadomienia o wcześniejszym terminie">
          <input type="number" min="0" max="720" className={inputCls} value={noticeHours} onChange={e => setNoticeHours(e.target.value)} />
        </Field>
        <Field label="Przypomnienia SMS o wizycie" hint="24 h przed terminem">
          <Select value={reminderMode} onChange={setReminderMode}
            options={[
              { value: 'NONE', label: 'brak' },
              { value: 'REMINDER', label: 'tylko przypomnienie' },
              { value: 'CONFIRM', label: 'przypomnienie + potwierdzenie' },
            ]} />
        </Field>
        {reminderMode === 'CONFIRM' && (
          <Field label="Prośba o potwierdzenie [h przed]">
            <Select value={confirmHours} onChange={setConfirmHours} options={[12, 24, 48, 72, 168].map(n => ({ value: String(n), label: `${n} h` }))} />
          </Field>
        )}
      </div>
      <div className="mt-3">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>Zapisz ustawienia</Button>
      </div>

      {docs && docs.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-extrabold text-gray-900">Lekarze: długość wizyty i gabinet</p>
          <p className="mb-2 text-xs font-medium text-gray-500">
            Długość pusta = siatka placówki ({intervalMin} min). Gabinet podpowiada się recepcji przy meldowaniu. Zapis po wyjściu z pola.
          </p>
          <div className="space-y-1.5">
            {docs.map(d => (
              <div key={`${d.doctor_id}:${d.slot_duration_min ?? ''}:${d.room ?? ''}`} className="flex items-center gap-2 rounded-xl bg-gray-50 px-3.5 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{d.name}</span>
                <input type="number" min="5" max="120" step="5" defaultValue={d.slot_duration_min ?? ''}
                  placeholder={String(intervalMin)} aria-label="długość wizyty [min]" className={`${inputCls} w-20 text-center`}
                  onBlur={e => {
                    const v = e.target.value.trim()
                    const num = v === '' ? null : Number(v)
                    if (num !== d.slot_duration_min) setLen.mutate({ id: String(d.doctor_id), val: num })
                  }} />
                <span className="text-xs font-bold text-gray-500">min</span>
                <input type="text" maxLength={20} defaultValue={d.room ?? ''} placeholder="gab."
                  aria-label="gabinet" className={`${inputCls} w-20 text-center`}
                  onBlur={e => {
                    const v = e.target.value.trim() || null
                    if (v !== d.room) setRoom.mutate({ id: String(d.doctor_id), room: v })
                  }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      {ok && <p className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-700">{ok}</p>}
    </Tile>
    <Tile className="mt-4 p-5"><ServicesManager clinicId={clinic.clinic_id} /></Tile>
    </>
  )
}
