// Podgląd dokumentu w aplikacji — natywny widok danych z bazy (te same pola,
// z których w locie generowany jest PDF), bez osadzania PDF-a w przeglądarce.
import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button, Modal, StatusBadge } from '../ui'
import { API_URL, getAuthToken } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatDatePL, formatTime } from '../lib/format'
import type { DocumentOut } from '../lib/types'

const KIND: Record<string, string> = {
  PRESCRIPTION: 'E-recepta',
  REFERRAL: 'E-skierowanie',
  LAB_RESULT: 'Wynik badania',
  SICK_LEAVE: 'E-ZLA (zwolnienie)',
  NOTE: 'Notatka z wizyty',
}

export function PodgladDokumentu({ doc, onClose }: {
  doc: DocumentOut
  onClose: () => void
}) {
  const { t } = useI18n()
  const [error, setError] = useState(false)

  const downloadPdf = async () => {
    const resp = await fetch(`${API_URL}/documents/${doc.document_id}/pdf`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
    if (!resp.ok) { setError(true); return }
    const blob = await resp.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `novamed-dokument-${doc.document_id}.pdf`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Modal
      overline={t('Podgląd dokumentu')}
      title={t(KIND[doc.document_type] ?? 'Dokument')}
      onClose={onClose}
      footer={
        <Button size="sm" variant="secondary" onClick={() => void downloadPdf()}>
          <Download size={14} /> {t('Pobierz PDF')}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        {doc.code && (
          <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary-soft/40 py-4 text-center">
            <p className="text-[10px] font-extrabold tracking-wider text-primary/60 uppercase">{t('kod dokumentu')}</p>
            <p className="text-3xl font-extrabold tracking-[0.3em] text-primary">{doc.code}</p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-xs font-extrabold tracking-wider text-gray-400 uppercase">{t('Pacjent')}</dt>
            <dd className="mt-0.5 font-bold text-gray-900">{doc.patient_name}</dd>
          </div>
          <div>
            <dt className="text-xs font-extrabold tracking-wider text-gray-400 uppercase">{t('Wystawił(a)')}</dt>
            <dd className="mt-0.5 font-bold text-gray-900">{doc.doctor_name}</dd>
          </div>
          <div>
            <dt className="text-xs font-extrabold tracking-wider text-gray-400 uppercase">{t('Data wystawienia')}</dt>
            <dd className="mt-0.5 font-bold text-gray-900">
              {formatDatePL(doc.issued_at)}, {formatTime(doc.issued_at)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-extrabold tracking-wider text-gray-400 uppercase">{t('Status')}</dt>
            <dd className="mt-1"><StatusBadge status={doc.document_status} /></dd>
          </div>
        </dl>

        {doc.details && (
          <div className="rounded-2xl bg-gray-50 px-4 py-3">
            <p className="mb-1 text-xs font-extrabold tracking-wider text-gray-400 uppercase">{t('Treść')}</p>
            <p className="text-sm leading-relaxed font-medium whitespace-pre-wrap text-gray-800">{doc.details}</p>
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">
            {t('Nie udało się pobrać PDF — spróbuj ponownie.')}
          </p>
        )}
      </div>
    </Modal>
  )
}
