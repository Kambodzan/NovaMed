// UC-P6: udostępnianie dokumentacji jednorazowym kodem.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Share2, Trash2 } from 'lucide-react'
import { Button, EmptyState, Field, Overline, Tile, TileHeader, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { formatDatePL, formatTime } from '../lib/format'
import type { ShareOut } from '../lib/types'

const SCOPE_LABEL: Record<string, string> = {
  ALL: 'Cała dokumentacja',
  LAB_RESULT: 'Tylko wyniki badań',
  PRESCRIPTION: 'Tylko e-recepty',
  LAST_12M: 'Dokumenty z ostatnich 12 miesięcy',
}

export function Udostepnij() {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const scopeLabel = (s: { scope: string; scope_label: string }) => t(SCOPE_LABEL[s.scope] ?? s.scope_label)
  const [scope, setScope] = useState('ALL')
  const [hours, setHours] = useState('24')
  const [lastCode, setLastCode] = useState<ShareOut | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: shares } = useQuery({
    queryKey: ['shares'],
    queryFn: () => api<ShareOut[]>('/shares/my'),
  })

  const create = useMutation({
    mutationFn: () => api<ShareOut>('/shares', {
      method: 'POST', body: { scope, hours_valid: Number(hours) },
    }),
    onSuccess: (s) => { setLastCode(s); setError(null); void queryClient.invalidateQueries({ queryKey: ['shares'] }) },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się wygenerować kodu.'),
  })

  const revoke = useMutation({
    mutationFn: (id: number) => api(`/shares/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      if (lastCode?.share_id === id) setLastCode(null)
      void queryClient.invalidateQueries({ queryKey: ['shares'] })
    },
  })

  const copy = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="fade-up">
        <h1 className="text-[28px] font-extrabold tracking-tight text-gray-900">{t('Udostępnij dokumentację')}</h1>
        <p className="mt-1.5 text-sm leading-relaxed font-medium text-gray-500">
          {t('Lekarz lub pielęgniarka wpisze kod w swoim portalu i zobaczy wybrane dokumenty. Dostęp możesz odwołać w każdej chwili.')}
        </p>
      </div>

      <Tile delay={60}>
        <div className="space-y-4">
          <Field label={t('Zakres udostępnienia')}>
            <select className={inputCls} value={scope} onChange={e => setScope(e.target.value)}>
              <option value="ALL">{t('Cała dokumentacja')}</option>
              <option value="LAB_RESULT">{t('Tylko wyniki badań')}</option>
              <option value="PRESCRIPTION">{t('Tylko e-recepty')}</option>
              <option value="LAST_12M">{t('Dokumenty z ostatnich 12 miesięcy')}</option>
            </select>
          </Field>
          <Field label={t('Ważność kodu')}>
            <select className={inputCls} value={hours} onChange={e => setHours(e.target.value)}>
              <option value="24">{t('24 godziny')}</option>
              <option value="168">{t('7 dni')}</option>
              <option value="720">{t('30 dni')}</option>
            </select>
          </Field>
          {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

          {!lastCode ? (
            <Button size="lg" disabled={create.isPending} onClick={() => create.mutate()}>
              <Share2 size={17} /> {create.isPending ? t('Generowanie…') : t('Wygeneruj kod')}
            </Button>
          ) : (
            <div className="rounded-2xl bg-primary-soft p-6 text-center">
              <Overline className="!text-primary/60">{t('Przekaż ten kod lekarzowi lub pielęgniarce')}</Overline>
              <p className="my-3 text-4xl font-extrabold tracking-[0.25em] text-primary">{lastCode.access_code}</p>
              <p className="text-xs font-semibold text-gray-400">
                {scopeLabel(lastCode)} · {t('ważny do:')} {formatDatePL(lastCode.expires_at)}, {formatTime(lastCode.expires_at)}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void copy(lastCode.access_code)}>
                  <Copy size={14} /> {copied ? t('Skopiowano!') : t('Kopiuj')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLastCode(null)}>{t('Wygeneruj kolejny')}</Button>
              </div>
            </div>
          )}
        </div>
      </Tile>

      <Tile delay={120}>
        <TileHeader title={t('Aktywne udostępnienia')} />
        {shares && shares.length > 0 ? (
          <ul className="space-y-1.5">
            {shares.map(s => (
              <li key={s.share_id} className="flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold tracking-[0.15em] text-gray-900">{s.access_code}</p>
                  <p className="text-xs font-medium text-gray-500">
                    {scopeLabel(s)} · {t('do')} {formatDatePL(s.expires_at)}, {formatTime(s.expires_at)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(s.share_id)}>
                  <Trash2 size={14} /> {t('Unieważnij')}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Share2 size={28} strokeWidth={1.5} />}
            title={t('Nikt nie ma teraz dostępu')}
            hint={t('Wygenerowane kody pojawią się w tym miejscu — możesz je unieważnić w każdej chwili.')}
          />
        )}
      </Tile>
    </div>
  )
}
