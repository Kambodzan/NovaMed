import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CalendarPlus, Check, MapPin, Star, Video } from 'lucide-react'
import { Button, DateChip, EmptyState, Modal, Overline, StatusBadge, Tile, cx, inputCls } from '../ui'
import { API_URL, api, ApiError, getAuthToken } from '../lib/api'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'

async function downloadIcs(appointmentId: number) {
  const resp = await fetch(`${API_URL}/appointments/${appointmentId}/ics`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  })
  if (!resp.ok) throw new Error(`ICS HTTP ${resp.status}`)
  const blob = await resp.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `wizyta-${appointmentId}.ics`
  a.click()
  URL.revokeObjectURL(a.href)
}
import { dayNo, formatDatePL, formatTime, isFuture, monthShort } from '../lib/format'
import type { AppointmentOut, BookOut } from '../lib/types'

export function Wizyty() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [cancelFor, setCancelFor] = useState<AppointmentOut | null>(null)
  const [rescheduleFor, setRescheduleFor] = useState<AppointmentOut | null>(null)
  const [reviewFor, setReviewFor] = useState<AppointmentOut | null>(null)
  const [payFor, setPayFor] = useState<AppointmentOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { activeId, asPatient } = useFamily()
  const { t } = useI18n()
  const { data: visits } = useQuery({
    queryKey: ['my-appointments', activeId],
    queryFn: () => api<AppointmentOut[]>(asPatient('/appointments/my')),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
    void queryClient.invalidateQueries({ queryKey: ['slots'] })
  }

  const cancel = useMutation({
    mutationFn: (id: number) => api(`/appointments/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { invalidate(); setCancelFor(null); setError(null) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się anulować wizyty.'),
  })

  const upcoming = (visits ?? [])
    .filter(v => ['CONFIRMED', 'TEMP_LOCK', 'IN_PROGRESS'].includes(v.appointment_status)
      && (isFuture(v.appointment_datetime) || v.appointment_status === 'IN_PROGRESS'))
    .sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))
  const past = (visits ?? []).filter(v => !upcoming.includes(v))

  const Row = ({ v, actions }: { v: AppointmentOut; actions?: boolean }) => (
    <Tile className="p-4">
      <div className="flex flex-wrap items-center gap-4">
        <DateChip month={monthShort(v.appointment_datetime)} day={dayNo(v.appointment_datetime)} time={formatTime(v.appointment_datetime)} />
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-gray-900">{v.doctor_name}</p>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-500">
            {v.specialization}
            {' · '}
            {v.appointment_type === 'ONLINE' ? <Video size={13} /> : <MapPin size={13} />}
            {v.appointment_type === 'ONLINE' ? t('teleporada') : v.clinic_name}
          </p>
        </div>
        <StatusBadge status={v.appointment_status} />
        {actions && v.appointment_status === 'CONFIRMED' && (
          <div className="flex gap-2">
            {v.appointment_type === 'ONLINE' && (
              <Button size="sm" onClick={() => navigate(`/telewizyta/${v.appointment_id}`)}>
                <Video size={14} /> {t('Rozpocznij')}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => { setRescheduleFor(v); setError(null) }}>{t('Zmień termin')}</Button>
            <Button size="sm" variant="ghost" title={t('Dodaj do kalendarza (ICS)')}
              onClick={() => downloadIcs(v.appointment_id).catch(() => setError(t('Nie udało się pobrać pliku z wizytą — spróbuj ponownie.')))}>
              <CalendarPlus size={14} /> {t('Do kalendarza')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setCancelFor(v); setError(null) }}>{t('Anuluj')}</Button>
          </div>
        )}
        {actions && v.appointment_status === 'IN_PROGRESS' && v.appointment_type === 'ONLINE' && (
          <Button size="sm" onClick={() => navigate(`/telewizyta/${v.appointment_id}`)}>
            <Video size={14} /> {t('Dołącz do wizyty')}
          </Button>
        )}
        {actions && v.appointment_status === 'TEMP_LOCK' && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { setPayFor(v); setError(null) }}>{t('Dokończ płatność')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setCancelFor(v); setError(null) }}>{t('Zwolnij rezerwację')}</Button>
          </div>
        )}
        {!actions && v.appointment_status === 'COMPLETED' && !v.reviewed && (
          <Button size="sm" variant="secondary" onClick={() => setReviewFor(v)}>
            <Star size={14} /> {t('Oceń')}
          </Button>
        )}
        {!actions && v.appointment_status === 'COMPLETED' && v.reviewed && (
          <span className="text-xs font-bold text-gray-400">{t('opinia wystawiona')}</span>
        )}
      </div>
    </Tile>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="fade-up text-[28px] font-extrabold tracking-tight text-gray-900">{t('Moje wizyty')}</h1>

      <section className="space-y-3">
        <Overline>{t('Nadchodzące · bezpłatne odwołanie do 24 h przed terminem')}</Overline>
        {upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={28} strokeWidth={1.5} />}
            title={t('Brak nadchodzących wizyt')}
            hint={t('Umów wizytę w zakładce „Umów wizytę”.')}
          />
        ) : upcoming.map(v => <Row key={v.appointment_id} v={v} actions />)}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <Overline>{t('Historia')}</Overline>
          {past.map(v => <Row key={v.appointment_id} v={v} />)}
        </section>
      )}

      {cancelFor && (
        <Modal
          overline={t('Moje wizyty')}
          title={t('Anulować wizytę?')}
          onClose={() => setCancelFor(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setCancelFor(null)}>{t('Wróć')}</Button>
            <Button variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate(cancelFor.appointment_id)}>
              {cancel.isPending ? t('Anulowanie…') : t('Tak, anuluj')}
            </Button>
          </>}
        >
          <p className="text-sm leading-relaxed font-medium text-gray-600">
            {cancelFor.doctor_name} — {formatDatePL(cancelFor.appointment_datetime)}, {formatTime(cancelFor.appointment_datetime)}. {t('Termin wróci do puli wolnych terminów.')}
          </p>
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
        </Modal>
      )}

      {rescheduleFor && (
        <RescheduleModal
          visit={rescheduleFor}
          onClose={() => setRescheduleFor(null)}
          onDone={() => { invalidate(); setRescheduleFor(null) }}
        />
      )}

      {payFor && (
        <PayModal
          visit={payFor}
          onClose={() => setPayFor(null)}
          onDone={() => { invalidate(); setPayFor(null) }}
        />
      )}

      {reviewFor && (
        <ReviewModal
          visit={reviewFor}
          onClose={() => setReviewFor(null)}
          onDone={() => { invalidate(); setReviewFor(null) }}
        />
      )}
    </div>
  )
}

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button" aria-label={`${i} gwiazdek`} aria-pressed={i <= value}
          onClick={() => onChange(i === value ? 0 : i)}
          className="cursor-pointer p-0.5 transition-transform hover:scale-110">
          <Star size={26} className={i <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-200'} />
        </button>
      ))}
    </div>
  )
}

function ReviewModal({ visit, onClose, onDone }: {
  visit: AppointmentOut
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const [doctorRating, setDoctorRating] = useState(0)
  const [doctorComment, setDoctorComment] = useState('')
  const [clinicRating, setClinicRating] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const submit = useMutation({
    mutationFn: () => api('/reviews', {
      method: 'POST',
      body: {
        appointment_id: visit.appointment_id,
        doctor_rating: doctorRating || null,
        doctor_comment: doctorComment || null,
        clinic_rating: clinicRating || null,
      },
    }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się zapisać opinii.'),
  })

  return (
    <Modal
      overline={t('Opinia po wizycie (UC-P8)')}
      title={visit.doctor_name}
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('Anuluj')}</Button>
        <Button disabled={submit.isPending || (doctorRating === 0 && clinicRating === 0)} onClick={() => submit.mutate()}>
          <Check size={14} /> {submit.isPending ? t('Zapisywanie…') : t('Wyślij opinię')}
        </Button>
      </>}
    >
      <div className="space-y-4 pb-2">
        <div className={cx('rounded-2xl p-4', doctorRating ? 'bg-primary-soft' : 'bg-gray-50')}>
          <p className="mb-2 text-sm font-extrabold text-gray-900">{t('Oceń lekarza')}</p>
          <Stars value={doctorRating} onChange={setDoctorRating} />
          {doctorRating > 0 && (
            <textarea
              className={cx(inputCls, 'mt-3 h-16 py-2')}
              value={doctorComment}
              onChange={e => setDoctorComment(e.target.value)}
              placeholder={t('Komentarz (opcjonalnie)')}
            />
          )}
        </div>
        <div className={cx('rounded-2xl p-4', clinicRating ? 'bg-primary-soft' : 'bg-gray-50')}>
          <p className="mb-2 text-sm font-extrabold text-gray-900">{t('Oceń placówkę —')} {visit.clinic_name}</p>
          <Stars value={clinicRating} onChange={setClinicRating} />
        </div>
        <p className="text-xs font-medium text-gray-400">{t('Możesz ocenić lekarza, placówkę lub oboje.')}</p>
        {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      </div>
    </Modal>
  )
}

function PayModal({ visit, onClose, onDone }: {
  visit: AppointmentOut
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [declined, setDeclined] = useState(false)

  const pay = useMutation({
    mutationFn: (outcome: 'success' | 'failure') =>
      api<BookOut>(`/appointments/${visit.appointment_id}/pay`, { method: 'POST', body: { outcome } }),
    onSuccess: (data) => {
      if (data.payment?.payment_status === 'PAID') onDone()
      else { setDeclined(true); setError(null) }
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('Płatność nie powiodła się.')),
  })

  return (
    <Modal
      overline={`${visit.doctor_name} · ${formatDatePL(visit.appointment_datetime)}, ${formatTime(visit.appointment_datetime)}`}
      title={t('Dokończ płatność')}
      onClose={onClose}
    >
      <div className="space-y-3 pb-4">
        {declined ? (
          <>
            <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">
              {t('Płatność odrzucona')}. {t('Termin wrócił do puli wolnych terminów. Możesz spróbować ponownie lub wybrać inny termin.')}
            </p>
            <Button variant="secondary" onClick={onDone}>{t('Wróć')}</Button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-500">
              {t('Termin zablokowany. Do zapłaty:')}{' '}
              <span className="font-extrabold text-gray-900">{visit.price} zł</span>.{' '}
              {t('Operator płatności jest symulowany — wybierz wynik autoryzacji.')}
            </p>
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button disabled={pay.isPending} onClick={() => pay.mutate('success')}>
                {t('Zapłać kartą (symulacja)')}
              </Button>
              <Button variant="secondary" disabled={pay.isPending} onClick={() => pay.mutate('failure')}>
                {t('Symuluj odmowę płatności')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function RescheduleModal({ visit, onClose, onDone }: {
  visit: AppointmentOut
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const { data: slots } = useQuery({
    queryKey: ['slots', visit.doctor_id],
    queryFn: () => api<AppointmentOut[]>(`/slots?doctor_id=${visit.doctor_id}`),
  })

  const reschedule = useMutation({
    mutationFn: (newId: number) => api(`/appointments/${visit.appointment_id}/reschedule`, {
      method: 'POST', body: { new_appointment_id: newId },
    }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się przełożyć wizyty.'),
  })

  return (
    <Modal overline={`${visit.doctor_name} · ${t('obecnie')} ${formatTime(visit.appointment_datetime)}`} title={t('Wybierz nowy termin')} onClose={onClose}>
      {error && <p className="mb-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      {slots && slots.length > 0 ? (
        <ul className="space-y-2 pb-4">
          {slots.slice(0, showAll ? undefined : 8).map(s => (
            <li key={s.appointment_id} className="flex items-center gap-3 rounded-2xl bg-gray-50 p-3">
              <DateChip month={monthShort(s.appointment_datetime)} day={dayNo(s.appointment_datetime)} time={formatTime(s.appointment_datetime)} />
              <span className="flex-1 text-sm font-semibold text-gray-500">
                {s.appointment_type === 'ONLINE' ? t('teleporada') : s.clinic_name}
              </span>
              <Button size="sm" disabled={reschedule.isPending} onClick={() => reschedule.mutate(s.appointment_id)}>
                {t('Wybierz')}
              </Button>
            </li>
          ))}
          {!showAll && slots.length > 8 && (
            <li className="text-center">
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                {t('Pokaż więcej terminów')} ({slots.length - 8})
              </Button>
            </li>
          )}
        </ul>
      ) : (
        <p className="pb-4 text-sm font-medium text-gray-500">{t('Ten lekarz nie ma teraz wolnych terminów.')}</p>
      )}
    </Modal>
  )
}
