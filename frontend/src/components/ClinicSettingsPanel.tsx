// Panel konfiguracji placówki — wspólny dla Panelu Admina (dowolna placówka sieci)
// i Panelu Poradni (placówka kierownika). Ustawienia (siatka terminów = standard
// długości wizyt, przypomnienia, wyprzedzenie) + katalog usług. Długość wizyty NIE
// jest per lekarz — obowiązuje siatka placówki.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Tile, inputCls } from '../ui'
import { Select } from './Select'
import { ServicesManager } from './ServicesManager'
import type { ClinicLite } from './ClinicPicker'
import { api, ApiError } from '../lib/api'

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

  return (
    <>
    <Tile className="p-5">
      <p className="mb-3 text-sm font-extrabold text-gray-900">Ustawienia placówki</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Siatka terminów [min]" hint="co ile minut sloty — to standard długości wizyty w placówce">
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

      {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      {ok && <p className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-700">{ok}</p>}
    </Tile>
    <Tile className="mt-4 p-5"><ServicesManager clinicId={clinic.clinic_id} grid={clinic.slot_interval_min} /></Tile>
    </>
  )
}
