// Przekładanie wizyty przez personel (rejestracja) — wybór nowego wolnego terminu
// z kalendarzyka. Backend pilnuje tego samego rodzaju/ceny; pokazujemy tylko zgodne
// terminy. Wspólny dla kartoteki pacjenta i tablicy dnia (Kalendarz). UC-P9/P10.
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Modal } from '../ui'
import { SlotCalendar } from './SlotCalendar'
import { api, ApiError } from '../lib/api'
import { formatDatePL, formatTime, isFuture } from '../lib/format'
import type { AppointmentOut } from '../lib/types'

export function StaffReschedule({ visit, onClose, onDone }: {
  visit: AppointmentOut
  onClose: () => void
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const scope = visit.doctor_id ? `doctor_id=${visit.doctor_id}` : `clinic_id=${visit.clinic_id}`
  const { data: slots } = useQuery({
    queryKey: ['slots', visit.doctor_id, visit.clinic_id],
    queryFn: () => api<AppointmentOut[]>(`/slots?${scope}`),
  })
  // backend pilnuje tego samego rodzaju i ceny — pokazujemy tylko zgodne terminy
  const eligible = (slots ?? []).filter(s =>
    s.appointment_id !== visit.appointment_id
    && s.service_name === visit.service_name
    && (s.price || 0) === (visit.price || 0)
    && isFuture(s.appointment_datetime),
  )
  const reschedule = useMutation({
    mutationFn: (newId: string) => api(`/appointments/${visit.appointment_id}/reschedule`, {
      method: 'POST', body: { new_appointment_id: newId },
    }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się przełożyć wizyty.'),
  })

  return (
    <Modal
      overline={`${visit.doctor_name} · obecnie ${formatDatePL(visit.appointment_datetime)}, ${formatTime(visit.appointment_datetime)}`}
      title="Wybierz nowy termin" onClose={onClose}
    >
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      <SlotCalendar
        slots={eligible}
        busy={reschedule.isPending}
        showMeta={!visit.doctor_id || eligible.some(s => s.appointment_type === 'ONLINE')}
        onPick={s => reschedule.mutate(s.appointment_id)}
      />
    </Modal>
  )
}
