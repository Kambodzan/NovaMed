// Podgląd dokumentu w aplikacji (PDF w modalu) — zamiast wymuszania pobierania.
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button, Modal } from '../ui'
import { API_URL, getAuthToken } from '../lib/api'
import { useI18n } from '../lib/i18n'

export function PodgladDokumentu({ documentId, title, onClose }: {
  documentId: number
  title: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    fetch(`${API_URL}/documents/${documentId}/pdf`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
      .then(r => { if (!r.ok) throw new Error(); return r.blob() })
      .then(blob => {
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => setError(true))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [documentId])

  return (
    <Modal
      wide
      overline={t('Podgląd dokumentu')}
      title={title}
      onClose={onClose}
      footer={url ? (
        <a href={url} download={`novamed-dokument-${documentId}.pdf`}>
          <Button size="sm" variant="secondary"><Download size={14} /> {t('Pobierz PDF')}</Button>
        </a>
      ) : undefined}
    >
      <div className="pb-2">
        {error ? (
          <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">
            {t('Nie udało się wczytać podglądu — spróbuj pobrać PDF.')}
          </p>
        ) : url ? (
          <iframe src={url} title={title} className="h-[70vh] w-full rounded-xl bg-gray-100" />
        ) : (
          <p className="py-16 text-center text-sm font-semibold text-gray-400">{t('Wczytywanie podglądu…')}</p>
        )}
      </div>
    </Modal>
  )
}
