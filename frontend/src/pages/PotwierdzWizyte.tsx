// Zarządzanie wizytą z linka SMS — strona PUBLICZNA (bez logowania). Gość może
// potwierdzić obecność, przełożyć termin (kalendarzyk), odwołać wizytę oraz
// dołączyć do teleporady wideo. Link: https://<host>/potwierdz/<token>.
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CalendarRange, Check, HeartPulse, MapPin, Video, X } from 'lucide-react'
import { SlotCalendar } from '../components/SlotCalendar'
import { Button, Tile } from '../ui'
import { api, ApiError } from '../lib/api'
import { formatDatePL, formatTime } from '../lib/format'
import type { AppointmentOut } from '../lib/types'

interface VisitPublic {
  appointment_id: string
  patient_name: string
  doctor_name: string
  clinic_name: string
  address: string | null
  appointment_datetime: string
  online: boolean
  status: string
  confirmed: boolean
}

export function PotwierdzWizyte() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const key = ['public-visit', token]
  const [mode, setMode] = useState<'view' | 'reschedule'>('view')
  const [err, setErr] = useState<string | null>(null)

  const { data: visit, error, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<VisitPublic>(`/public/visit/${token}`),
    retry: false,
  })

  const act = useMutation({
    mutationFn: (what: 'confirm' | 'cancel') => api<VisitPublic>(`/public/visit/${token}/${what}`, { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(key, data),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Coś poszło nie tak.'),
  })

  const { data: slots } = useQuery({
    queryKey: ['public-visit-slots', token],
    queryFn: () => api<AppointmentOut[]>(`/public/visit/${token}/slots`),
    enabled: mode === 'reschedule',
  })

  const reschedule = useMutation({
    mutationFn: (newId: string) => api<VisitPublic>(`/public/visit/${token}/reschedule`, {
      method: 'POST', body: { new_appointment_id: newId },
    }),
    onSuccess: (data) => { queryClient.setQueryData(key, data); setMode('view'); setErr(null) },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Nie udało się przełożyć wizyty.'),
  })

  const cancelled = visit?.status === 'CANCELLED'
  const canManage = visit?.status === 'CONFIRMED'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-7 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white">
          <HeartPulse size={28} />
        </span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-gray-900">NovaMed</h1>
        <p className="mt-1 text-sm font-semibold text-gray-400">Twoja wizyta</p>
      </div>

      <Tile className="w-full max-w-md p-6">
        {isLoading ? (
          <p className="py-8 text-center text-sm font-semibold text-gray-400">Wczytywanie…</p>
        ) : error ? (
          <div className="py-6 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600"><X size={24} /></span>
            <p className="text-sm font-bold text-gray-900">
              {error instanceof ApiError ? error.message : 'Link jest nieprawidłowy lub wygasł.'}
            </p>
            <p className="mt-1 text-sm font-medium text-gray-500">Skontaktuj się z rejestracją placówki.</p>
          </div>
        ) : visit && (
          <>
            <div className="rounded-2xl bg-gray-50 px-4 py-4">
              <p className="text-sm font-semibold text-gray-500">Pacjent</p>
              <p className="mb-3 text-lg font-extrabold text-gray-900">{visit.patient_name}</p>
              <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <CalendarClock size={15} className="text-primary" />
                {formatDatePL(visit.appointment_datetime)}, {formatTime(visit.appointment_datetime)}
              </p>
              <p className="mt-1.5 text-sm font-medium text-gray-500">{visit.doctor_name}</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-gray-500">
                {visit.online
                  ? <><Video size={14} /> Teleporada (wideo)</>
                  : <><MapPin size={14} /> {visit.clinic_name}{visit.address ? `, ${visit.address}` : ''}</>}
              </p>
            </div>

            {err && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-center text-sm font-bold text-red-700">{err}</p>}

            {/* stany końcowe */}
            {cancelled ? (
              <p className="mt-4 rounded-2xl bg-red-50 px-4 py-4 text-center text-sm font-bold text-red-700">Wizyta została odwołana. Dziękujemy za informację.</p>
            ) : !canManage ? (
              <p className="mt-4 rounded-2xl bg-gray-50 px-4 py-4 text-center text-sm font-bold text-gray-500">Tej wizyty nie można już zmieniać.</p>
            ) : mode === 'reschedule' ? (
              <div className="mt-4">
                <p className="mb-2 text-sm font-bold text-gray-900">Wybierz nowy termin</p>
                <SlotCalendar
                  slots={slots ?? []}
                  busy={reschedule.isPending}
                  showMeta={visit.online}
                  onPick={s => reschedule.mutate(s.appointment_id)}
                />
                <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => { setMode('view'); setErr(null) }}>
                  Wróć
                </Button>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {visit.online && (
                  <Button size="lg" className="w-full" onClick={() => navigate(`/teleporada/${visit.appointment_id}?vt=${token}`)}>
                    <Video size={17} /> Dołącz do teleporady
                  </Button>
                )}
                {!visit.confirmed && (
                  <Button size="lg" variant={visit.online ? 'secondary' : 'primary'} className="w-full"
                    disabled={act.isPending} onClick={() => act.mutate('confirm')}>
                    <Check size={17} /> {act.isPending ? 'Wysyłanie…' : 'Potwierdzam, że będę'}
                  </Button>
                )}
                {visit.confirmed && (
                  <p className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-center text-sm font-bold text-emerald-700">
                    <Check size={16} /> Obecność potwierdzona
                  </p>
                )}
                <Button size="lg" variant="secondary" className="w-full" onClick={() => { setMode('reschedule'); setErr(null) }}>
                  <CalendarRange size={16} /> Przełóż termin
                </Button>
                <Button size="lg" variant="ghost" className="w-full" disabled={act.isPending} onClick={() => act.mutate('cancel')}>
                  Odwołaj wizytę
                </Button>
              </div>
            )}
          </>
        )}
      </Tile>
      <p className="mt-5 text-xs font-medium text-gray-400">Bezpieczny link NovaMed</p>
    </div>
  )
}
