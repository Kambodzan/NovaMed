// Skierowania pacjenta — osobna strona z akcją „Umów na podstawie skierowania".
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, Download, Eye, FileSignature } from 'lucide-react'
import { Button, EmptyState, Overline, StatusBadge, Tile } from '../ui'
import { PodgladDokumentu } from '../components/PodgladDokumentu'
import { API_URL, api, getAuthToken } from '../lib/api'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { formatDatePL } from '../lib/format'
import type { DocumentOut } from '../lib/types'

async function downloadPdf(documentId: number) {
  const resp = await fetch(`${API_URL}/documents/${documentId}/pdf`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  })
  if (!resp.ok) throw new Error(`PDF HTTP ${resp.status}`)
  const blob = await resp.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `novamed-skierowanie-${documentId}.pdf`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function SkierowaniaPacjenta() {
  const navigate = useNavigate()
  const { activeId, asPatient } = useFamily()
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [previewFor, setPreviewFor] = useState<DocumentOut | null>(null)

  const { data: docs } = useQuery({
    queryKey: ['my-documents', activeId],
    queryFn: () => api<DocumentOut[]>(asPatient('/documents/my')),
  })
  const skierowania = (docs ?? []).filter(d => d.document_type === 'REFERRAL')

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="fade-up text-[28px] font-extrabold tracking-tight text-gray-900">{t('Skierowania')}</h1>
      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      {skierowania.length === 0 ? (
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
                <Tile className="p-5" delay={80 + i * 40}>
                  <div className="flex flex-wrap items-start gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                      <FileSignature size={19} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Overline>{formatDatePL(doc.issued_at)} · {doc.doctor_name}</Overline>
                      <p className="mt-1 text-sm leading-relaxed font-medium text-gray-700">{doc.details}</p>
                      {doc.code && (
                        <p className="mt-1.5 text-xs font-semibold text-gray-400">
                          {t('kod:')} <span className="rounded-md bg-gray-100 px-2 py-0.5 font-extrabold tracking-[0.2em] text-gray-900">{doc.code}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={doc.document_status} />
                      {active && doc.referral_type !== 'NURSING' && (
                        <Button size="sm" onClick={() => navigate(`/umow?mode=exam&refDoc=${doc.document_id}`)}>
                          <CalendarPlus size={14} /> {t('Umów na podstawie skierowania')}
                        </Button>
                      )}
                      {active && doc.referral_type === 'NURSING' && (
                        <p className="max-w-44 text-right text-xs font-semibold text-gray-400">
                          {t('Zabieg zaplanuje pielęgniarka — skierowanie czeka w jej kolejce.')}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setPreviewFor(doc)}>
                          <Eye size={14} /> {t('Podgląd')}
                        </Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => downloadPdf(doc.document_id).then(() => setError(null), () => setError(t('Nie udało się pobrać PDF — spróbuj ponownie.')))}>
                          <Download size={14} />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Tile>
              </li>
            )
          })}
        </ul>
      )}

      {previewFor && <PodgladDokumentu doc={previewFor} onClose={() => setPreviewFor(null)} />}
    </div>
  )
}
