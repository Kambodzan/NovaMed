// UC-P6 (strona personelu): dostęp do udostępnionej dokumentacji kodem od pacjenta.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileSignature, FileText, FlaskConical, KeyRound, Pill } from 'lucide-react'
import { Button, Overline, PageHeader, StatusBadge, Tile, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import { formatDatePL, formatTime } from '../lib/format'
import type { DocumentOut, SharedDocsOut } from '../lib/types'

const docIcon: Record<DocumentOut['document_type'], typeof FileText> = {
  PRESCRIPTION: Pill, REFERRAL: FileSignature, LAB_RESULT: FlaskConical,
  SICK_LEAVE: FileText, NOTE: FileText,
}

export function KodOdPacjenta() {
  const [code, setCode] = useState('')
  const [shared, setShared] = useState<SharedDocsOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const access = useMutation({
    mutationFn: () => api<SharedDocsOut>('/shares/access', { method: 'POST', body: { code } }),
    onSuccess: (data) => { setShared(data); setError(null) },
    onError: (e) => { setShared(null); setError(e instanceof ApiError ? e.message : 'Nie udało się otworzyć dokumentacji.') },
  })

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline="UC-P6 · dostęp tymczasowy, w zakresie wybranym przez pacjenta"
          title="Dokumentacja z kodu"
        />
      </div>

      <Tile delay={60}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={e => { e.preventDefault(); if (code.trim().length >= 6) access.mutate() }}
        >
          <div className="min-w-56 flex-1">
            <label className="mb-1.5 block text-sm font-bold text-gray-700">Kod od pacjenta</label>
            <input
              className={cx(inputCls, 'font-extrabold tracking-[0.2em] uppercase')}
              placeholder="np. K7M-4PD"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              maxLength={8}
            />
          </div>
          <Button disabled={access.isPending || code.trim().length < 6} type="submit">
            <KeyRound size={15} /> {access.isPending ? 'Otwieranie…' : 'Otwórz dokumentację'}
          </Button>
        </form>
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      </Tile>

      {shared && (
        <Tile className="p-5" delay={60}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-primary-soft px-4 py-3">
            <div>
              <p className="font-extrabold text-gray-900">{shared.patient_name}</p>
              <p className="text-xs font-semibold text-gray-500">PESEL {shared.pesel}</p>
            </div>
            <Overline className="!text-primary/70">
              {shared.scope_label} · dostęp do {formatDatePL(shared.expires_at)}, {formatTime(shared.expires_at)}
            </Overline>
          </div>

          {shared.documents.length === 0 ? (
            <p className="py-6 text-center text-sm font-medium text-gray-400">Brak dokumentów w udostępnionym zakresie.</p>
          ) : (
            <ul className="space-y-2">
              {shared.documents.map(d => {
                const Icon = docIcon[d.document_type] ?? FileText
                return (
                  <li key={d.document_id} className="flex flex-wrap items-start gap-3 rounded-2xl bg-gray-50 px-4 py-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary tile-shadow">
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-900">{d.details ?? d.document_type}</p>
                      <p className="text-xs font-semibold text-gray-400">
                        {formatDatePL(d.issued_at)} · {d.doctor_name}{d.code ? ` · kod: ${d.code}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={d.document_status} />
                  </li>
                )
              })}
            </ul>
          )}
        </Tile>
      )}
    </div>
  )
}
