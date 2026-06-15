// Wybór placówki dla stron personelu (sieciówka = wiele placówek).
// Hook trzyma listę + wybraną placówkę (domyślnie pierwsza), komponent
// renderuje select tylko gdy placówek jest >1.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Select } from './Select'

export interface ClinicLite {
  clinic_id: string; clinic_name: string
  // ustawienia placówki (zwracane przez /clinics) — używane m.in. w Kalendarzu rejestracji
  slot_interval_min: number
  earlier_notice_min_hours: number
  reminder_mode: 'NONE' | 'REMINDER' | 'CONFIRM'
  confirmation_required: boolean
  confirmation_hours: number
}

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
    <Select
      ariaLabel="Placówka" className="w-56"
      value={value ?? ''} onChange={onChange}
      options={clinics.map(c => ({ value: c.clinic_id, label: c.clinic_name }))}
    />
  )
}
