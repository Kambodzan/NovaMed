// Skierowania pacjenta + umawianie ZE SKIEROWANIA w miejscu (focused picker):
// „Umów" otwiera modal z wolnymi terminami NFZ dopasowanymi do typu skierowania
// (LAB → badania, SPECIALIST → wizyta u specjalisty) i rezerwuje z podpiętym
// skierowaniem — bez przeskakiwania na duży ekran wyszukiwania.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, Check, FileSignature, MapPin, Video } from 'lucide-react'
import { Button, DateChip, EmptyState, Loading, Modal, Overline, StatusBadge, Tile, cx } from '../ui'
import { Select } from '../components/Select'
import { PodgladDokumentu } from '../components/PodgladDokumentu'
import { api, ApiError } from '../lib/api'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { dayNo, formatDatePL, formatTime, monthShort } from '../lib/format'
import type { AppointmentOut, DocumentOut } from '../lib/types'

export function SkierowaniaPacjenta() {
  const { activeId, asPatient } = useFamily()
  const { t } = useI18n()
  const [previewFor, setPreviewFor] = useState<DocumentOut | null>(null)
  const [umowFor, setUmowFor] = useState<DocumentOut | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()

  const { data: docs } = useQuery({
    queryKey: ['my-documents', activeId],
    queryFn: () => api<DocumentOut[]>(asPatient('/documents/my')),
  })
  const skierowania = (docs ?? []).filter(d => d.document_type === 'REFERRAL')

  // wejście z „Do zrobienia" na pulpicie: /skierowania?umow=<id> → otwórz picker
  useEffect(() => {
    const id = params.get('umow')
    if (id && docs) {
      const d = skierowania.find(x => x.document_id === id)
      if (d) setUmowFor(d)
      params.delete('umow'); setParams(params, { replace: true })
    }
  }, [params, docs])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="fade-up text-[28px] font-extrabold tracking-tight text-gray-900">{t('Skierowania')}</h1>

      {done && (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-bold text-emerald-700 fade-up">
          <Check size={15} /> {done}
        </p>
      )}

      {docs === undefined ? <Loading /> : skierowania.length === 0 ? (
        <EmptyState
          icon={<FileSignature size={28} strokeWidth={1.5} />}
          title={t('Brak skierowań')}
          hint={t('Skierowania od lekarza pojawią się tutaj — z każdego aktywnego umówisz termin jednym kliknięciem.')}
        />
      ) : (
        <ul className="space-y-3">
          {skierowania.map((doc, i) => {
            const active = ['ACTIVE', 'CONFIRMED'].includes(doc.document_status)
            return (
              <li key={doc.document_id}>
                <button type="button" className="block w-full cursor-pointer text-left"
                  onClick={() => setPreviewFor(doc)} title={t('Podgląd')}>
                  <Tile className="p-5 transition-shadow hover:ring-2 hover:ring-primary/20" delay={80 + i * 40}>
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                        <FileSignature size={19} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Overline>{formatDatePL(doc.issued_at)} · {doc.doctor_name}</Overline>
                        <p className="mt-1 text-sm leading-relaxed font-medium text-gray-700">{doc.details}</p>
                        {active && doc.referral_type === 'NURSING' && (
                          <p className="mt-1 text-xs font-medium text-gray-400">
                            {t('Zabieg zaplanuje pielęgniarka — skierowanie czeka w jej kolejce.')}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadge status={doc.document_status} />
                        {active && doc.referral_type !== 'NURSING' && (
                          <Button size="sm"
                            onClick={e => { e.stopPropagation(); setUmowFor(doc) }}>
                            <CalendarPlus size={14} /> {t('Umów termin')}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Tile>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {previewFor && <PodgladDokumentu doc={previewFor} onClose={() => setPreviewFor(null)} />}
      {umowFor && (
        <UmowZeSkierowania
          doc={umowFor}
          onClose={() => setUmowFor(null)}
          onBooked={(label) => { setUmowFor(null); setDone(label) }}
        />
      )}
    </div>
  )
}

function UmowZeSkierowania({ doc, onClose, onBooked }: {
  doc: DocumentOut
  onClose: () => void
  onBooked: (label: string) => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const { asPatient } = useFamily()
  const isLab = doc.referral_type === 'LAB'
  const [spec, setSpec] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: slots } = useQuery({
    queryKey: ['slots'],
    queryFn: () => api<AppointmentOut[]>('/slots'),
  })
  // skierowanie = świadczenie NFZ (bezpłatne); LAB → badania, SPECIALIST → wizyty
  const nfz = (slots ?? []).filter(s => s.price == null)
  const specs = isLab ? [] : [...new Set(nfz.filter(s => s.service_name == null).flatMap(s => s.specializations))].sort()
  const matched = nfz.filter(s =>
    (isLab ? s.service_name != null : s.service_name == null)
    && (isLab || !spec || s.specializations.includes(spec)),
  ).sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime))

  const book = useMutation({
    mutationFn: (id: string) => api(asPatient(`/appointments/${id}/book`), {
      method: 'POST', body: { referral_document_id: doc.document_id },
    }),
    onSuccess: (_d, id) => {
      const s = matched.find(x => x.appointment_id === id)!
      void queryClient.invalidateQueries({ queryKey: ['my-documents'] })
      void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
      void queryClient.invalidateQueries({ queryKey: ['slots'] })
      onBooked(`${t('Umówiono ze skierowania')}: ${isLab ? s.service_name : s.doctor_name} — ${formatDatePL(s.appointment_datetime)}, ${formatTime(s.appointment_datetime)}.`)
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('Nie udało się umówić wizyty.')),
  })

  return (
    <Modal
      overline={`${doc.doctor_name} · ${formatDatePL(doc.issued_at)}`}
      title={isLab ? t('Umów badanie ze skierowania') : t('Umów wizytę ze skierowania')}
      onClose={onClose}
    >
      <div className="space-y-3 pb-2">
        <p className="rounded-2xl bg-primary-soft px-4 py-3 text-sm font-medium text-gray-700">{doc.details}</p>
        {!isLab && specs.length > 1 && (
          <Select value={spec} onChange={setSpec} ariaLabel={t('Specjalizacja')}
            options={[{ value: '', label: t('Wszystkie specjalizacje') }, ...specs.map(s => ({ value: s, label: s }))]} />
        )}
        {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
        {slots === undefined ? <Loading /> : matched.length === 0 ? (
          <p className="rounded-2xl bg-gray-50 px-4 py-6 text-center text-sm font-medium text-gray-500">
            {t('Brak wolnych terminów NFZ dla tego skierowania. Wróć później — terminy pojawiają się na bieżąco.')}
          </p>
        ) : (
          <ul className="space-y-2">
            {matched.slice(0, showAll ? undefined : 8).map(s => (
              <li key={s.appointment_id} className="flex items-center gap-3 rounded-2xl bg-gray-50 p-3">
                <DateChip month={monthShort(s.appointment_datetime)} day={dayNo(s.appointment_datetime)} time={formatTime(s.appointment_datetime)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-gray-900">{isLab ? s.service_name : s.doctor_name}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs font-semibold text-gray-500">
                    {!isLab && s.appointment_type === 'ONLINE' ? <><Video size={12} /> {t('teleporada')}</> : <><MapPin size={12} /> {s.clinic_name}</>}
                    {!isLab && s.specializations.length ? ` · ${s.specializations.join(' · ')}` : ''}
                  </span>
                </span>
                <Button size="sm" disabled={book.isPending} onClick={() => book.mutate(s.appointment_id)}>{t('Wybierz')}</Button>
              </li>
            ))}
            {!showAll && matched.length > 8 && (
              <li className={cx('text-center')}>
                <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                  {t('Pokaż więcej terminów')} ({matched.length - 8})
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
    </Modal>
  )
}
