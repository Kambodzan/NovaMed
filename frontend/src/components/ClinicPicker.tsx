// Wybór placówki dla stron personelu (sieciówka = wiele placówek).
// Hook trzyma listę + wybraną placówkę (domyślnie pierwsza), komponent
// renderuje select tylko gdy placówek jest >1.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cx, inputCls } from '../ui'
import { api } from '../lib/api'

export interface ClinicLite { clinic_id: string; clinic_name: string }

export function useClinicSelection() {
  const { data: clinics } = useQuery({ queryKey: ['clinics'], queryFn: () => api<ClinicLite[]>('/clinics') })
  const [clinicId, setClinicId] = useState<string | null>(null)
  const clinic = (clinics ?? []).find(c => c.clinic_id === clinicId) ?? clinics?.[0]
  return { clinics: clinics ?? [], clinic, setClinicId }
}

export function ClinicSelect({ clinics, value, onChange }: {
  clinics: ClinicLite[]
  value: string | undefined
  onChange: (clinicId: string) => void
}) {
  if (clinics.length <= 1) return null
  return (
    <select
      aria-label="Placówka"
      className={cx(inputCls, 'w-56')}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
    >
      {clinics.map(c => <option key={c.clinic_id} value={c.clinic_id}>{c.clinic_name}</option>)}
    </select>
  )
}
