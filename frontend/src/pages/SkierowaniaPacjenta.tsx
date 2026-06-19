// Skierowania pacjenta + umawianie ZE SKIEROWANIA w miejscu (focused picker):
// „Umów" otwiera modal z wolnymi terminami NFZ dopasowanymi do typu skierowania
// (LAB → badania, SPECIALIST → wizyta u specjalisty) i rezerwuje z podpiętym
// skierowaniem — bez przeskakiwania na duży ekran wyszukiwania.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, Check, ChevronDown, FileSignature, FlaskConical } from 'lucide-react'
import { Avatar, Button, EmptyState, Loading, Modal, Overline, StatusBadge, Tile, cx } from '../ui'
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
  const [error, setError] = useState<string | null>(null)

  const { data: slots } = useQuery({
    queryKey: ['slots'],
    queryFn: () => api<AppointmentOut[]>('/slots'),
  })
  // skierowanie = świadczenie NFZ (bezpłatne); LAB → badania, SPECIALIST → wizyty
  const nfz = (slots ?? []).filter(s => s.price == null && (isLab ? s.service_name != null : s.service_name == null))
  const specs = isLab ? [] : [...new Set(nfz.flatMap(s => s.specializations))].sort()
  const filtered = nfz.filter(s => isLab || !spec || s.specializations.includes(spec))

  // grupowanie po lekarzu (SPECIALIST) / badaniu (LAB) → dni → terminy
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; sub: string | null; days: Map<string, AppointmentOut[]> }>()
    for (const s of filtered) {
      const key = (isLab ? s.service_name : s.doctor_id) ?? ''
      const cur = map.get(key) ?? {
        key, name: (isLab ? s.service_name : s.doctor_name) ?? '',
        sub: isLab ? null : (s.specializations.join(' · ') || null),
        days: new Map<string, AppointmentOut[]>(),
      }
      const day = s.appointment_datetime.slice(0, 10)
      cur.days.set(day, [...(cur.days.get(day) ?? []), s])
      map.set(key, cur)
    }
    return [...map.values()].map(g => ({
      ...g,
      days: [...g.days.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([d, l]) => [d, l.sort((x, y) => x.appointment_datetime.localeCompare(y.appointment_datetime))] as const),
    }))
  }, [filtered, isLab])

  const book = useMutation({
    mutationFn: (s: AppointmentOut) => api(asPatient(`/appointments/${s.appointment_id}/book`), {
      method: 'POST', body: { referral_document_id: doc.document_id },
    }),
    onSuccess: (_d, s) => {
      void queryClient.invalidateQueries({ queryKey: ['my-documents'] })
      void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
      void queryClient.invalidateQueries({ queryKey: ['slots'] })
      onBooked(`${t('Umówiono ze skierowania')}: ${isLab ? s.service_name : s.doctor_name} — ${formatDatePL(s.appointment_datetime)}, ${formatTime(s.appointment_datetime)}.`)
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('Nie udało się umówić wizyty.')),
  })

  return (
    <Modal
      wide
      overline={`${doc.doctor_name} · ${formatDatePL(doc.issued_at)}`}
      title={isLab ? t('Umów badanie ze skierowania') : t('Umów wizytę ze skierowania')}
      onClose={onClose}
    >
      <div className="space-y-3 pb-2">
        <div className="flex items-start gap-2.5 rounded-2xl bg-primary-soft px-4 py-3">
          <FileSignature size={16} className="mt-0.5 shrink-0 text-primary" />
          <p className="text-sm font-medium text-gray-700">{doc.details}</p>
        </div>

        {!isLab && specs.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {[{ v: '', l: t('Wszyscy') }, ...specs.map(s => ({ v: s, l: s }))].map(o => (
              <button key={o.v} onClick={() => setSpec(o.v)}
                className={cx('cursor-pointer rounded-full px-3 py-1.5 text-xs font-extrabold transition-colors',
                  spec === o.v ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                {o.l}
              </button>
            ))}
          </div>
        )}

        {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

        {slots === undefined ? <Loading /> : groups.length === 0 ? (
          <EmptyState icon={<CalendarPlus size={26} strokeWidth={1.5} />} title={t('Brak wolnych terminów NFZ')}
            hint={t('Wróć później — terminy pojawiają się na bieżąco.')} />
        ) : (
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {groups.map((g, i) => (
              <ProviderSlots key={g.key} g={g} isLab={isLab} defaultOpen={groups.length === 1 || i === 0}
                busy={book.isPending} onPick={s => book.mutate(s)} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function ProviderSlots({ g, isLab, defaultOpen, busy, onPick }: {
  g: { name: string; sub: string | null; days: ReadonlyArray<readonly [string, AppointmentOut[]]> }
  isLab: boolean
  defaultOpen: boolean
  busy: boolean
  onPick: (s: AppointmentOut) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const nearest = g.days[0][1][0]
  const initials = g.name.replace(/^(dr|lek\.)\s+/i, '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="rounded-2xl bg-gray-50">
      <button onClick={() => setOpen(o => !o)} className="flex w-full cursor-pointer items-center gap-3 p-3.5 text-left">
        {isLab ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><FlaskConical size={16} /></span>
        ) : (
          <Avatar initials={initials} size="sm" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-gray-900">{g.name}</span>
          {g.sub && <span className="block truncate text-xs font-semibold text-gray-500">{g.sub}</span>}
        </span>
        <span className="shrink-0 text-xs font-extrabold text-primary">
          {dayNo(nearest.appointment_datetime)} {monthShort(nearest.appointment_datetime)}, {formatTime(nearest.appointment_datetime)}
        </span>
        <ChevronDown size={15} className={cx('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid grid-cols-3 gap-2 border-t border-gray-200/70 p-3.5 pt-3">
          {g.days.slice(0, 3).map(([day, list]) => (
            <div key={day} className="min-w-0">
              <p className="mb-1.5 text-center text-[10px] font-extrabold tracking-wide text-gray-400 uppercase">
                {dayNo(day + 'T00:00:00')} {monthShort(day + 'T00:00:00')}
              </p>
              <div className="flex flex-col gap-1">
                {list.slice(0, 5).map(s => (
                  <button key={s.appointment_id} disabled={busy} onClick={() => onPick(s)}
                    className="cursor-pointer rounded-lg bg-surface px-1 py-1.5 text-center text-xs font-bold text-primary shadow-sm hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
                    {formatTime(s.appointment_datetime)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
