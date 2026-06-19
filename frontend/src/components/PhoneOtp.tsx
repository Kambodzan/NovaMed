// Weryfikacja telefonu kodem SMS dla ścieżek bez logowania (rezerwacja publiczna,
// rejestracja). Wyślij kod → wpisz → numer potwierdzony. W DEV kod pokazuje się
// w podpowiedzi (Twilio trial dostarcza tylko na zweryfikowany numer).
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, MessageSquare } from 'lucide-react'
import { Button, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'

export function PhoneOtp({ phone, purpose, verified, onVerified, disabled }: {
  phone: string
  purpose: 'BOOKING' | 'REGISTRATION'
  verified: boolean
  onVerified: () => void
  disabled?: boolean
}) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const send = useMutation({
    mutationFn: () => api<{ sent: boolean; dev_code: string | null }>('/public/otp/send', {
      method: 'POST', body: { phone_number: phone, purpose },
    }),
    onSuccess: d => { setSent(true); setDevCode(d.dev_code); setError(null) },
    onError: e => setError(e instanceof ApiError ? e.message : 'Nie udało się wysłać kodu.'),
  })
  const verify = useMutation({
    mutationFn: () => api('/public/otp/verify', {
      method: 'POST', body: { phone_number: phone, code, purpose },
    }),
    onSuccess: () => { onVerified(); setError(null) },
    onError: e => setError(e instanceof ApiError ? e.message : 'Nieprawidłowy kod.'),
  })

  if (verified) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700">
        <Check size={16} /> Numer telefonu potwierdzony
      </p>
    )
  }

  const phoneOk = phone.replace(/\D/g, '').length >= 7

  return (
    <div className="space-y-2 rounded-2xl bg-gray-50 px-4 py-3">
      {!sent ? (
        <>
          <p className="text-sm font-semibold text-gray-600">Potwierdź numer — wyślemy na niego kod SMS.</p>
          <Button type="button" variant="secondary" size="sm" disabled={!phoneOk || disabled || send.isPending}
            onClick={() => send.mutate()}>
            <MessageSquare size={14} /> {send.isPending ? 'Wysyłanie…' : 'Wyślij kod SMS'}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-gray-600">
            Wpisz 6-cyfrowy kod z SMS-a wysłanego na <b>{phone}</b>.
            {devCode && <span className="ml-1 font-bold text-gray-500">(DEV: {devCode})</span>}
          </p>
          <div className="flex gap-2">
            <input className={cx(inputCls, 'flex-1 tracking-[0.4em]')} inputMode="numeric" maxLength={6}
              placeholder="••••••" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            <Button type="button" size="sm" disabled={code.length !== 6 || verify.isPending}
              onClick={() => verify.mutate()}>
              {verify.isPending ? 'Sprawdzanie…' : 'Potwierdź'}
            </Button>
          </div>
          <button type="button" onClick={() => send.mutate()} disabled={send.isPending}
            className="cursor-pointer text-xs font-bold text-primary hover:underline disabled:opacity-50">
            Wyślij kod ponownie
          </button>
        </>
      )}
      {error && <p className="text-sm font-bold text-red-600">{error}</p>}
    </div>
  )
}
