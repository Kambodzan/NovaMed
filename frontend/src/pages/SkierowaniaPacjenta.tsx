// Skierowania pacjenta + „Umów ze skierowania": kieruje na zwykły ekran „Umów
// wizytę" z kontekstem skierowania (mode wg typu: LAB→badanie, SPECIALIST→wizyta),
// gdzie skierowanie podpina się automatycznie przy rezerwacji.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, FileSignature } from 'lucide-react'
import { Button, EmptyState, Loading, Overline, StatusBadge, Tile } from '../ui'
import { PodgladDokumentu } from '../components/PodgladDokumentu'
import { api } from '../lib/api'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { formatDatePL } from '../lib/format'
import type { DocumentOut } from '../lib/types'

export function SkierowaniaPacjenta() {
  const navigate = useNavigate()
  const { activeId, asPatient } = useFamily()
  const { t } = useI18n()
  const [previewFor, setPreviewFor] = useState<DocumentOut | null>(null)

  const { data: docs } = useQuery({
    queryKey: ['my-documents', activeId],
    queryFn: () => api<DocumentOut[]>(asPatient('/documents/my')),
  })
  const skierowania = (docs ?? []).filter(d => d.document_type === 'REFERRAL')

  // LAB → szukaj badania; SPECIALIST → szukaj wizyty u specjalisty
  const umow = (doc: DocumentOut) =>
    navigate(`/umow?mode=${doc.referral_type === 'LAB' ? 'exam' : 'visit'}&refDoc=${doc.document_id}`)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="fade-up text-[28px] font-extrabold tracking-tight text-gray-900">{t('Skierowania')}</h1>

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
                          <p className="mt-1 text-xs font-medium text-gray-500">
                            {t('Zabieg zaplanuje pielęgniarka — skierowanie czeka w jej kolejce.')}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <StatusBadge status={doc.document_status} />
                        {active && doc.referral_type !== 'NURSING' && (
                          <Button size="sm" onClick={e => { e.stopPropagation(); umow(doc) }}>
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
    </div>
  )
}
