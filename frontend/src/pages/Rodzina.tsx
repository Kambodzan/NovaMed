// Konta rodzinne: profile podopiecznych — lista + dodawanie. Przełączanie
// profilu w nagłówku portalu (selektor obok dzwonka).
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Users } from 'lucide-react'
import { Button, EmptyState, Field, PageHeader, Tile, TileHeader, inputCls } from '../ui'
import { api, ApiError } from '../lib/api'
import { useFamily } from '../lib/family'
import { useI18n } from '../lib/i18n'
import { formatDatePL } from '../lib/format'

export function Rodzina() {
  const queryClient = useQueryClient()
  const { dependents, activeId, setActiveId } = useFamily()
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ first_name: '', last_name: '', pesel: '', birth_date: '' })

  const add = useMutation({
    mutationFn: () => api('/family', { method: 'POST', body: form }),
    onSuccess: () => {
      setError(null)
      setForm({ first_name: '', last_name: '', pesel: '', birth_date: '' })
      void queryClient.invalidateQueries({ queryKey: ['family'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Nie udało się dodać podopiecznego.'),
  })

  return (
    <div className="space-y-6">
      <div className="fade-up">
        <PageHeader
          overline={t('Konta rodzinne')}
          title={t('Rodzina')}
          sub={t('Profile podopiecznych — umawiaj wizyty i przeglądaj ich dokumentację w ich imieniu')}
        />
      </div>

      <Tile className="p-5" delay={60}>
        <TileHeader title={<span className="inline-flex items-center gap-1.5"><Users size={13} /> {t('Podopieczni')}</span>} />
        {dependents.length === 0 ? (
          <EmptyState
            icon={<Users size={28} strokeWidth={1.5} />}
            title={t('Brak podopiecznych')}
            hint={t('Dodaj profil dziecka lub osoby pod opieką formularzem poniżej.')}
          />
        ) : (
          <ul className="space-y-1.5">
            {dependents.map(d => (
              <li key={d.patient_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-gray-900">{d.first_name} {d.last_name}</p>
                  <p className="text-xs font-medium text-gray-500">PESEL {d.pesel} · {t('ur.')} {formatDatePL(d.birth_date)}</p>
                </div>
                {activeId === d.patient_id ? (
                  <Button size="sm" variant="secondary" onClick={() => setActiveId(null)}>{t('Wróć na mój profil')}</Button>
                ) : (
                  <Button size="sm" onClick={() => setActiveId(d.patient_id)}>{t('Przełącz na ten profil')}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tile>

      <Tile className="p-5" delay={120}>
        <TileHeader title={t('Dodaj podopiecznego')} />
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
          onSubmit={e => { e.preventDefault(); add.mutate() }}
        >
          <Field label={t('Imię')}>
            <input className={inputCls} required minLength={1} value={form.first_name}
              onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
          </Field>
          <Field label={t('Nazwisko')}>
            <input className={inputCls} required minLength={1} value={form.last_name}
              onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
          </Field>
          <Field label="PESEL">
            <input className={inputCls} required pattern="\d{11}" title="11 cyfr" value={form.pesel}
              onChange={e => setForm(f => ({ ...f, pesel: e.target.value }))} />
          </Field>
          <Field label={t('Data urodzenia')}>
            <input type="date" className={inputCls} required value={form.birth_date}
              onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))} />
          </Field>
          <div className="flex items-end">
            <Button disabled={add.isPending} type="submit"><Plus size={15} /> {t('Dodaj')}</Button>
          </div>
        </form>
        <p className="mt-2 text-xs font-medium text-gray-400">
          {t('Podopieczny nie loguje się samodzielnie — wszystkie powiadomienia o jego wizytach i dokumentach trafiają do Ciebie.')}
        </p>
        {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
      </Tile>
    </div>
  )
}
