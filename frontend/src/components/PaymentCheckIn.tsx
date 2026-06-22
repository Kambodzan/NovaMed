// Płatna wizyta umówiona przez recepcję NIE jest opłacona z góry — przy meldowaniu
// („Przyszedł") recepcja oznacza opłatę na miejscu + ewentualną fakturę (mini-mock),
// a potem pacjent idzie do toru „Czeka". Jedno działanie: rozlicz → zamelduj.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { DoorOpen, FileText } from 'lucide-react'
import { Button, Modal } from '../ui'
import { api, ApiError } from '../lib/api'
import { pushToast } from '../lib/toast'
import { formatTime } from '../lib/format'
import type { AppointmentOut } from '../lib/types'

// wizyta wymaga opłaty na okienku: ma cenę i nie jest jeszcze opłacona
export const needsDeskPayment = (a: AppointmentOut) => !!a.price && a.payment_status !== 'PAID'

export function PaymentCheckIn({ appt, onClose, onDone }: {
  appt: AppointmentOut; onClose: () => void; onDone: () => void
}) {
  const [invoice, setInvoice] = useState(false)
  const run = useMutation({
    mutationFn: async () => {
      await api(`/appointments/${appt.appointment_id}/settle-payment`, { method: 'POST', body: { invoice } })
      return api(`/appointments/${appt.appointment_id}/arrival`, { method: 'POST', body: { checked_in: true } })
    },
    onSuccess: () => onDone(),
    onError: (e) => pushToast(e instanceof ApiError ? e.message : 'Nie udało się rozliczyć płatności.', 'error'),
  })
  return (
    <Modal title="Opłata za wizytę" overline={`${appt.patient_name} · ${formatTime(appt.appointment_datetime)}`} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Anuluj</Button>
        <Button disabled={run.isPending} onClick={() => run.mutate()}>
          <DoorOpen size={16} /> {run.isPending ? 'Rozliczanie…' : 'Opłacone — wpuść'}
        </Button>
      </>}>
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-2xl bg-amber-50 px-4 py-3">
          <span className="text-sm font-bold text-amber-800">Do zapłaty na miejscu</span>
          <span className="text-xl font-extrabold text-amber-900 [font-variant-numeric:tabular-nums]">{appt.price} zł</span>
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 rounded-2xl bg-gray-50 px-4 py-2.5">
          <input type="checkbox" className="h-4 w-4 accent-(--color-primary)" checked={invoice} onChange={e => setInvoice(e.target.checked)} />
          <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-700"><FileText size={15} /> Pacjent chce fakturę</span>
        </label>
        <p className="text-xs font-medium text-gray-500">Po oznaczeniu opłaty pacjent trafia do „Czeka".</p>
      </div>
    </Modal>
  )
}
