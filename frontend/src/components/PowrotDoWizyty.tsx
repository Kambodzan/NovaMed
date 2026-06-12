// Pasek „wizyta w toku" w portalu lekarza: gdy lekarz ma rozpoczętą wizytę
// i odejdzie na inną zakładkę, z każdego miejsca wraca jednym klikiem.
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { DoorOpen } from 'lucide-react'
import { api } from '../lib/api'
import { formatTime } from '../lib/format'
import type { AppointmentOut } from '../lib/types'

export function PowrotDoWizyty() {
  const location = useLocation()
  const navigate = useNavigate()
  const today = new Date().toISOString().slice(0, 10)
  const { data } = useQuery({
    queryKey: ['doctor-day', today],
    queryFn: () => api<AppointmentOut[]>(`/appointments/day?day=${today}`),
    refetchInterval: 30_000,
  })

  const active = (data ?? []).find(v => v.appointment_status === 'IN_PROGRESS')
  if (!active) return null
  const inRoom = [`/wizyta/${active.appointment_id}`, `/telewizyta/${active.appointment_id}`]
    .includes(location.pathname)
  if (inRoom) return null

  return (
    <div className="sticky top-3 z-30 mb-5">
      <button
        onClick={() => navigate(`/wizyta/${active.appointment_id}`)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-left text-white shadow-lg shadow-primary/25 transition-transform hover:scale-[1.01]"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold">
          Wizyta w toku: {active.patient_name} · {formatTime(active.appointment_datetime)}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-extrabold">
          <DoorOpen size={13} /> Wróć do gabinetu
        </span>
      </button>
    </div>
  )
}
