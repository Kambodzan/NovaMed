// Podgląd dokumentu w aplikacji — natywny widok danych z bazy (te same pola,
// z których w locie generowany jest PDF), bez osadzania PDF-a w przeglądarce.
import { useState } from 'react'
import { Ban, Download, Printer } from 'lucide-react'
import { Button, Modal, StatusBadge, cx, inputCls } from '../ui'
import { API_URL, getAuthToken } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatDatePL, formatTime } from '../lib/format'
import type { DocumentOut } from '../lib/types'

// dokumentu zrealizowanego/już anulowanego nie da się stornować
const CANCELLABLE = (s: string) => s !== 'REVOKED' && s !== 'REALIZED'

const KIND: Record<string, string> = {
  PRESCRIPTION: 'E-recepta',
  REFERRAL: 'E-skierowanie',
  LAB_RESULT: 'Wynik badania',
  SICK_LEAVE: 'E-ZLA (zwolnienie)',
  NOTE: 'Notatka z wizyty',
  CERTIFICATE: 'Zaświadczenie',
}

export function PodgladDokumentu({ doc, onClose, onCancel }: {
  doc: DocumentOut
  onClose: () => void
  onCancel?: (doc: DocumentOut, reason: string) => Promise<void> // tylko lekarz (storno)
}) {
  const { t } = useI18n()
  const [error, setError] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [canceling, setCanceling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const doCancel = async () => {
    if (!onCancel) return
    setCanceling(true); setCancelError(null)
    try {
      await onCancel(doc, reason.trim())
      onClose()
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Nie udało się anulować dokumentu.')
      setCanceling(false)
    }
  }

  const fetchPdf = async () => {
    const resp = await fetch(`${API_URL}/documents/${doc.document_id}/pdf`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
    if (!resp.ok) { setError(true); return null }
    return new Blob([await resp.blob()], { type: 'application/pdf' })
  }

  const downloadPdf = async () => {
    const blob = await fetchPdf()
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `novamed-dokument-${doc.document_id}.pdf`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // druk: PDF w nowej karcie — przeglądarkowa drukarka robi resztę
  const printPdf = async () => {
    const blob = await fetchPdf()
    if (!blob) return
    window.open(URL.createObjectURL(blob), '_blank')
  }

  return (
    <Modal
      overline={t('Podgląd dokumentu')}
      title={t(KIND[doc.document_type] ?? 'Dokument')}
      onClose={onClose}
      footer={<>
        <Button size="sm" variant="ghost" onClick={() => void printPdf()}>
          <Printer size={14} /> {t('Drukuj')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void downloadPdf()}>
          <Download size={14} /> {t('Pobierz PDF')}
        </Button>
        <Button size="sm" onClick={onClose}>{t('Zamknij')}</Button>
      </>}
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

        {doc.lab_values && doc.lab_values.length > 0 ? (
          <div className="rounded-2xl bg-gray-50 px-4 py-3">
            <p className="mb-2 text-xs font-extrabold tracking-wider text-gray-400 uppercase">{t('Wyniki')}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-extrabold tracking-wider text-gray-400 uppercase">
                  <th className="pb-1">{t('Parametr')}</th>
                  <th className="pb-1 text-right">{t('Wynik')}</th>
                  <th className="pb-1 text-right">{t('Norma')}</th>
                </tr>
              </thead>
              <tbody>
                {doc.lab_values.map((v, i) => {
                  const low = v.ref_low != null && v.value < v.ref_low
                  const high = v.ref_high != null && v.value > v.ref_high
                  const abn = low || high
                  const range = v.ref_low != null && v.ref_high != null ? `${v.ref_low}–${v.ref_high}`
                    : v.ref_high != null ? `< ${v.ref_high}` : v.ref_low != null ? `> ${v.ref_low}` : '—'
                  return (
                    <tr key={i} className="border-t border-gray-200/70">
                      <td className="py-1.5 font-semibold text-gray-700">{v.name}</td>
                      <td className={cx('py-1.5 text-right font-extrabold [font-variant-numeric:tabular-nums]', abn ? 'text-red-600' : 'text-gray-900')}>
                        {v.value} {v.unit}{abn && <span className="ml-1">{high ? '↑' : '↓'}</span>}
                      </td>
                      <td className="py-1.5 text-right text-xs font-medium text-gray-400 [font-variant-numeric:tabular-nums]">{range} {v.unit}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {doc.lab_values.some(v => (v.ref_low != null && v.value < v.ref_low) || (v.ref_high != null && v.value > v.ref_high)) && (
              <p className="mt-2 text-xs font-bold text-red-600">{t('Wartości poza normą oznaczono na czerwono (↑ powyżej, ↓ poniżej zakresu).')}</p>
            )}
          </div>
        ) : doc.details && (
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

        {/* storno — tylko w kontekście lekarza (onCancel przekazane) */}
        {onCancel && CANCELLABLE(doc.document_status) && (
          <div className="rounded-2xl border border-red-100 bg-red-50/50 px-4 py-3">
            {!confirming ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-red-700/80">Dokument wystawiony błędnie? Można go anulować (storno).</p>
                <Button size="sm" variant="ghost" className="!text-red-600 hover:!bg-red-100" onClick={() => setConfirming(true)}>
                  <Ban size={14} /> Anuluj dokument
                </Button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-sm font-bold text-red-800">Anulowanie jest nieodwracalne — dokument trafi do anulowanych, a e-recepta/e-ZLA/e-skierowanie także w P1/ZUS.</p>
                <input className={cx(inputCls, 'bg-surface')} value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Powód anulowania (opcjonalnie, trafi do pacjenta)" />
                {cancelError && <p className="text-sm font-bold text-red-700">{cancelError}</p>}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Wróć</Button>
                  <Button size="sm" variant="danger" disabled={canceling} onClick={() => void doCancel()}>
                    {canceling ? 'Anulowanie…' : 'Tak, anuluj dokument'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
