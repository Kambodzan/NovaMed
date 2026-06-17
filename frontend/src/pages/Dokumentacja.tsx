import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, FlaskConical, FolderOpen, Stamp } from 'lucide-react'
import { PodgladDokumentu } from '../components/PodgladDokumentu'
import { EmptyState, Loading, Overline, StatusBadge, Tile, cx } from '../ui'
import { api } from '../lib/api'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { formatDatePL } from '../lib/format'
import type { DocumentOut } from '../lib/types'

// recepty i skierowania mają własne strony — tu zostaje reszta dokumentacji
const docMeta: Record<string, { icon: typeof FileText; label: string }> = {
  LAB_RESULT: { icon: FlaskConical, label: 'Wynik badania' },
  SICK_LEAVE: { icon: FileText, label: 'E-ZLA' },
  CERTIFICATE: { icon: Stamp, label: 'Zaświadczenie' },
}

export function Dokumentacja() {
  // wejście z „Do zrobienia" (np. /dokumentacja?type=LAB_RESULT) ustawia filtr
  const [filter, setFilter] = useState<string>(() => new URLSearchParams(window.location.search).get('type') || 'ALL')
  const [previewFor, setPreviewFor] = useState<DocumentOut | null>(null)
  const { activeId, asPatient } = useFamily()
  const { t } = useI18n()
  const { data: docs } = useQuery({
    queryKey: ['my-documents', activeId],
    queryFn: () => api<DocumentOut[]>(asPatient('/documents/my')),
  })

  const filtered = (docs ?? [])
    .filter(d => d.document_type in docMeta)
    .filter(d => filter === 'ALL' || d.document_type === filter)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="fade-up text-[28px] font-extrabold tracking-tight text-gray-900">{t('Moja dokumentacja')}</h1>

      <div className="fade-up flex flex-wrap gap-2" style={{ animationDelay: '50ms' }}>
        {['ALL', ...Object.keys(docMeta)].map(kind => (
          <button
            key={kind}
            onClick={() => setFilter(kind)}
            className={cx(
              'cursor-pointer rounded-full px-4 py-2 text-xs font-extrabold transition-colors',
              filter === kind ? 'bg-primary text-white' : 'tile-shadow bg-surface text-gray-500 hover:text-gray-900',
            )}
          >
            {kind === 'ALL' ? t('Wszystkie') : t(docMeta[kind].label)}
          </button>
        ))}
      </div>

      {docs === undefined ? <Loading /> : filtered.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={28} strokeWidth={1.5} />}
          title={t('Brak dokumentów')}
          hint={t('E-recepty, skierowania i wyniki badań pojawią się tu po wizytach u lekarza.')}
        />
      ) : (
        <ul className="space-y-3">
          {filtered.map((doc, i) => {
            const m = docMeta[doc.document_type]
            return (
              <li key={doc.document_id}>
                <button type="button" className="block w-full cursor-pointer text-left"
                  onClick={() => setPreviewFor(doc)} title={t('Podgląd')}>
                <Tile className="p-5 transition-shadow hover:ring-2 hover:ring-primary/20" delay={100 + i * 40}>
                  <div className="flex flex-wrap items-start gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <m.icon size={19} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Overline>{t(m.label)} · {formatDatePL(doc.issued_at)}</Overline>
                      <p className="mt-1 text-sm leading-relaxed font-medium text-gray-600">{doc.details}</p>
                      <p className="mt-1.5 text-xs font-semibold text-gray-400">
                        {doc.doctor_name}
                        {doc.code && (
                          <> · {t('kod:')} <span className="rounded-md bg-gray-100 px-2 py-0.5 font-extrabold tracking-[0.2em] text-gray-900">{doc.code}</span></>
                        )}
                      </p>
                    </div>
                    <StatusBadge status={doc.document_status} />
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
