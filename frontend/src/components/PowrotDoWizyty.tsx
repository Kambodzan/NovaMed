// Pasek „wizyta w toku" w portalu lekarza: gdy lekarz ma rozpoczętą lub
// wstrzymaną wizytę i odejdzie na inną zakładkę, z każdego miejsca wraca jednym
// klikiem. Aktywna (jedna) — teal z pulsem; wstrzymane — bursztynowe pigułki.
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { DoorOpen, Pause } from 'lucide-react'
import { api } from '../lib/api'
import { formatTime } from '../lib/format'
import type { AppointmentOut } from '../lib/types'

export function PowrotDoWizyty() {
  const location = useLocation()
  const navigate = useNavigate()
  // otwarte wizyty lekarza (w toku / wstrzymane) NIEZALEŻNIE od daty — pasek działa
  // też po północy i dla wizyt z innego dnia (maks. jedna IN_PROGRESS na lekarza)
  const { data } = useQuery({
    queryKey: ['doctor-active'],
    queryFn: () => api<AppointmentOut[]>(`/appointments/active`),
    refetchInterval: 30_000,
  })

  const inRoom = (id: string) =>
    [`/wizyta/${id}`, `/telewizyta/${id}`].includes(location.pathname)

  const all = data ?? []
  const active = all.find(v => v.appointment_status === 'IN_PROGRESS')
  const paused = all.filter(v => v.appointment_status === 'PAUSED' && !inRoom(v.appointment_id))
  const showActive = active && !inRoom(active.appointment_id)
  if (!showActive && paused.length === 0) return null

  return (
    <div className="sticky top-3 z-30 mb-5 space-y-2">
      {showActive && (
        <button
          onClick={() => navigate(`/wizyta/${active!.appointment_id}`)}
          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-left text-white shadow-lg shadow-primary/25 transition-transform hover:scale-[1.01]"
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-bold">
            Wizyta w toku: {active!.patient_name} · {formatTime(active!.appointment_datetime)}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-extrabold">
            <DoorOpen size={13} /> Wróć do gabinetu
          </span>
        </button>
      )}
      {paused.map(v => (
        <button
          key={v.appointment_id}
          onClick={() => navigate(`/wizyta/${v.appointment_id}`)}
          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-amber-100 px-4 py-2.5 text-left text-amber-900 transition-transform hover:scale-[1.01]"
        >
          <Pause size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold">
            Wstrzymana: {v.patient_name} · {formatTime(v.appointment_datetime)}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-200/70 px-3 py-1.5 text-xs font-extrabold">
            <DoorOpen size={13} /> Wznów
          </span>
        </button>
      ))}
    </div>
  )
}
