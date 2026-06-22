// Panel Admina → Placówki: administrator zarządza ustawieniami DOWOLNEJ placówki
// w sieci + składem lekarzy (przydział do placówki). Reużywa wspólny panel
// konfiguracji co kierownik; backend dopuszcza admina i omija scoping.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { Button, PageHeader, Tile } from '../../ui'
import { Select } from '../../components/Select'
import { ClinicSelect, useClinicSelection, type ClinicLite } from '../../components/ClinicPicker'
import { ClinicSettingsPanel } from '../../components/ClinicSettingsPanel'
import { api, ApiError } from '../../lib/api'
import { pushToast } from '../../lib/toast'
import type { AdminUser } from '../../lib/types'

interface DoctorRow { doctor_id: string; name: string; specializations: string[] }

export function AdminPlacowki() {
  const { clinics, clinic, setClinicId } = useClinicSelection()
  return (
    <div className="space-y-4">
      <PageHeader
        overline="Administracja sieci"
        title="Placówki"
        sub="Skład lekarzy, ustawienia i usługi dowolnej placówki"
        action={<ClinicSelect clinics={clinics} value={clinic?.clinic_id} onChange={setClinicId} />}
      />
      {clinic && <ClinicDoctors key={`d-${clinic.clinic_id}`} clinic={clinic} />}
      {clinic && <ClinicSettingsPanel key={clinic.clinic_id} clinic={clinic} />}
    </div>
  )
}

// ---- skład lekarzy placówki + przydział nowego ----
function ClinicDoctors({ clinic }: { clinic: ClinicLite }) {
  const queryClient = useQueryClient()
  const [pick, setPick] = useState('')
  const { data: docs } = useQuery({
    queryKey: ['clinic-doctors', clinic.clinic_id],
    queryFn: () => api<DoctorRow[]>(`/clinics/${clinic.clinic_id}/doctors`),
  })
  const { data: users } = useQuery({ queryKey: ['admin-users'], queryFn: () => api<AdminUser[]>('/admin/users') })

  const inClinic = new Set((docs ?? []).map(d => d.doctor_id))
  // lekarze sieci jeszcze nieprzypisani do tej placówki
  const available = (users ?? [])
    .filter(u => u.role === 'lekarz' && u.active_account && !inClinic.has(u.user_id))
    .sort((a, b) => a.username.localeCompare(b.username, 'pl'))

  const assign = useMutation({
    mutationFn: (userId: string) => api(`/clinics/${clinic.clinic_id}/staff`, { method: 'POST', body: { user_id: userId } }),
    onSuccess: () => {
      setPick('')
      void queryClient.invalidateQueries({ queryKey: ['clinic-doctors', clinic.clinic_id] })
      pushToast('Lekarz przypisany do placówki.', 'success')
    },
    onError: (e) => pushToast(e instanceof ApiError ? e.message : 'Nie udało się przypisać lekarza.', 'error'),
  })

  return (
    <Tile className="p-5">
      <p className="mb-1 text-sm font-extrabold text-gray-900">Lekarze w placówce</p>
      <p className="mb-3 text-xs font-medium text-gray-500">Skład lekarzy tej placówki — to oni mają tu terminy i grafik.</p>

      {docs === undefined ? (
        <p className="text-sm text-gray-400">Wczytywanie…</p>
      ) : docs.length === 0 ? (
        <p className="rounded-2xl bg-gray-50 px-4 py-4 text-sm font-medium text-gray-500">Brak lekarzy — przypisz pierwszego poniżej.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {docs.map(d => (
            <span key={d.doctor_id} className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-1.5 text-sm font-bold text-gray-900">
              {d.name}{d.specializations.length > 0 && <span className="font-medium text-gray-400">· {d.specializations.join(' · ')}</span>}
            </span>
          ))}
        </div>
      )}

      {/* przydział kolejnego lekarza */}
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-4">
        <div className="min-w-[16rem] flex-1">
          <label className="mb-1 block text-xs font-extrabold text-gray-500">Przypisz lekarza</label>
          <Select value={pick} onChange={setPick} ariaLabel="Przypisz lekarza"
            placeholder={available.length ? 'Wybierz lekarza…' : 'Wszyscy lekarze już przypisani'}
            options={available.map(u => ({ value: u.user_id, label: u.username, hint: u.email }))} />
        </div>
        <Button disabled={!pick || assign.isPending} onClick={() => assign.mutate(pick)}>
          <UserPlus size={15} /> Przypisz
        </Button>
      </div>
    </Tile>
  )
}
