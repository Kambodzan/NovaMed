// Profil i ustawienia pacjenta — własne dane kontaktowe, status eWUŚ,
// preferencje powiadomień, zmiana hasła. (Samoobsługa pacjenta.)
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ShieldCheck } from 'lucide-react'
import { Badge, Button, Field, Loading, PageHeader, Tile, TileHeader, cx, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { formatDatePL } from '../lib/format'

interface Profile {
  first_name: string | null
  last_name: string | null
  pesel: string | null
  birth_date: string | null
  phone_number: string | null
  email: string
  insurance_status: boolean
  notify_sms: boolean
}

export function Profil() {
  const { t } = useI18n()
  const { refreshMe } = useAuth()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ first_name: '', last_name: '', phone_number: '' })
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: profile } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => api<Profile>('/auth/me/profile'),
  })
  useEffect(() => {
    if (profile) setForm({
      first_name: profile.first_name ?? '', last_name: profile.last_name ?? '',
      phone_number: profile.phone_number ?? '',
    })
  }, [profile])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['my-profile'] })
    void refreshMe()
  }
  const saveContact = useMutation({
    mutationFn: () => api<Profile>('/auth/me/contact', { method: 'PATCH', body: form }),
    onSuccess: () => { setError(null); setSaved(true); setTimeout(() => setSaved(false), 2500); refresh() },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('Nie udało się zapisać danych.')),
  })
  const toggleSms = useMutation({
    mutationFn: () => api('/auth/me/preferences', { method: 'PATCH', body: { notify_sms: !profile?.notify_sms } }),
    onSuccess: refresh,
  })

  if (!profile) return <div className="mx-auto max-w-2xl"><Loading /></div>

  const dirty = form.first_name !== (profile.first_name ?? '') || form.last_name !== (profile.last_name ?? '')
    || form.phone_number !== (profile.phone_number ?? '')

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="fade-up">
        <PageHeader overline={t('Konto')} title={t('Profil i ustawienia')} />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}

      <Tile className="p-5" delay={60}>
        <TileHeader title={t('Dane osobowe')} action={
          profile.insurance_status
            ? <Badge tone="success"><ShieldCheck size={12} /> {t('eWUŚ: ubezpieczony')}</Badge>
            : <Badge tone="warn"><AlertTriangle size={12} /> {t('eWUŚ: brak potwierdzenia')}</Badge>
        } />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('Imię')}>
            <input className={inputCls} value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
          </Field>
          <Field label={t('Nazwisko')}>
            <input className={inputCls} value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
          </Field>
          <Field label={t('Telefon')} hint={t('na ten numer pójdą SMS-y z przypomnieniami')}>
            <input className={inputCls} value={form.phone_number} placeholder="601 234 567"
              onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))} />
          </Field>
          <Field label={t('E-mail')}>
            <input className={cx(inputCls, 'bg-gray-50 text-gray-500')} value={profile.email} disabled />
          </Field>
          <Field label="PESEL">
            <input className={cx(inputCls, 'bg-gray-50 text-gray-500')} value={profile.pesel ?? '—'} disabled />
          </Field>
          <Field label={t('Data urodzenia')}>
            <input className={cx(inputCls, 'bg-gray-50 text-gray-500')} value={profile.birth_date ? formatDatePL(profile.birth_date) : '—'} disabled />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button disabled={!dirty || saveContact.isPending} onClick={() => saveContact.mutate()}>
            {saveContact.isPending ? t('Zapisywanie…') : t('Zapisz zmiany')}
          </Button>
          {saved && <span className="inline-flex items-center gap-1 text-sm font-bold text-emerald-700"><Check size={14} /> {t('Zapisano')}</span>}
        </div>
      </Tile>

      <Tile className="p-5" delay={100}>
        <TileHeader title={t('Powiadomienia')} />
        <button onClick={() => toggleSms.mutate()} disabled={toggleSms.isPending}
          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3 text-left hover:bg-gray-100">
          <span>
            <span className="block text-sm font-bold text-gray-900">{t('Powiadomienia SMS')}</span>
            <span className="block text-xs font-medium text-gray-600">{t('Przypomnienia o wizytach i nowe dokumenty SMS-em. Powiadomienia w aplikacji są zawsze aktywne.')}</span>
          </span>
          <span className={cx('shrink-0 rounded-full px-3 py-1 text-xs font-extrabold uppercase',
            profile.notify_sms ? 'bg-primary-soft text-primary' : 'bg-gray-200 text-gray-700')}>
            {profile.notify_sms ? t('wł.') : t('wył.')}
          </span>
        </button>
      </Tile>

      <Tile className="p-5" delay={140}>
        <TileHeader title={t('Hasło i bezpieczeństwo')} />
        <p className="text-sm font-medium text-gray-500">
          {t('Hasło zmienisz przez „Nie pamiętam hasła” na ekranie logowania — wyślemy link na Twój adres e-mail.')}
        </p>
      </Tile>
    </div>
  )
}
