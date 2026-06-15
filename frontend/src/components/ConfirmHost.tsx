import { useEffect, useState } from 'react'
import { Button, Modal } from '../ui'
import { useI18n } from '../lib/i18n'
import { _setConfirmListener, type ConfirmRequest } from '../lib/confirm'

// Jeden host dialogu potwierdzenia, montowany globalnie w App. Nasłuchuje
// żądań z confirm() i renderuje spójny Modal zamiast natywnego window.confirm.
export function ConfirmHost() {
  const { t } = useI18n()
  const [req, setReq] = useState<ConfirmRequest | null>(null)
  useEffect(() => { _setConfirmListener(setReq); return () => _setConfirmListener(null) }, [])
  if (!req) return null

  const close = (ok: boolean) => { req.resolve(ok); setReq(null) }
  return (
    <Modal
      title={req.title}
      onClose={() => close(false)}
      footer={<>
        <Button variant="secondary" onClick={() => close(false)}>{req.cancelLabel ?? t('Anuluj')}</Button>
        <Button variant={req.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
          {req.confirmLabel ?? t('Potwierdź')}
        </Button>
      </>}
    >
      {req.message && (
        <p className="pb-2 text-sm leading-relaxed font-medium text-gray-600">{req.message}</p>
      )}
    </Modal>
  )
}
