import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, HeartPulse } from 'lucide-react'
import { Button, Field, Tile, cx, inputCls } from '../ui'
import { DEV_MODE, useAuth } from '../lib/auth'
import { api } from '../lib/api'

export function Rejestracja() {
  const { token, profileMissing, registerAccount, refreshMe } = useAuth()
  const navigate = useNavigate()
  // krok 1 pominięty, jeśli konto już jest a brakuje tylko profilu (UC-P1 dokończenie)
  const [step, setStep] = useState<1 | 2>(token && profileMissing ? 2 : 1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [profile, setProfile] = useState({
    first_name: '', last_name: '', pesel: '', birth_date: '', phone_number: '',
  })

  const submitAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await registerAccount(email, password)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się utworzyć konta.')
    } finally {
      setBusy(false)
    }
  }

  const submitProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/auth/register-profile', {
        method: 'POST',
        body: { ...profile, phone_number: profile.phone_number || null },
      })
      await refreshMe()
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zapisać profilu.')
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof typeof profile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setProfile(p => ({ ...p, [key]: e.target.value }))

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="fade-up mb-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white">
          <HeartPulse size={28} />
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900">Rejestracja</h1>
        <ol className="mt-3 flex items-center justify-center gap-2">
          {['Konto', 'Twoje dane'].map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={cx(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold',
                step > i + 1 ? 'bg-primary text-white' : step === i + 1 ? 'bg-primary-soft text-primary' : 'bg-gray-100 text-gray-400',
              )}>
                {step > i + 1 ? <Check size={13} /> : i + 1}
              </span>
              <span className={cx('text-xs font-bold', step === i + 1 ? 'text-gray-900' : 'text-gray-400')}>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <Tile className="w-full max-w-sm p-6" delay={80}>
        {step === 1 ? (
          <form className="space-y-4" onSubmit={submitAccount}>
            <Field label="Adres e-mail">
              <input className={inputCls} type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </Field>
            <Field label="Hasło" hint={DEV_MODE ? 'Tryb deweloperski — hasło nie jest zapisywane.' : 'Minimum 8 znaków.'}>
              <input className={inputCls} type="password" minLength={DEV_MODE ? undefined : 8} required={!DEV_MODE} value={password} onChange={e => setPassword(e.target.value)} />
            </Field>
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
            <Button size="lg" className="w-full" disabled={busy} type="submit">Dalej</Button>
            <p className="text-center text-sm font-medium text-gray-500">
              Masz już konto? <Link to="/login" className="font-extrabold text-primary hover:underline">Zaloguj się</Link>
            </p>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={submitProfile}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Imię"><input className={inputCls} required value={profile.first_name} onChange={set('first_name')} /></Field>
              <Field label="Nazwisko"><input className={inputCls} required value={profile.last_name} onChange={set('last_name')} /></Field>
            </div>
            <Field label="PESEL" hint="11 cyfr — potrzebny do e-recept i weryfikacji eWUŚ.">
              <input className={inputCls} required pattern="\d{11}" value={profile.pesel} onChange={set('pesel')} />
            </Field>
            <Field label="Data urodzenia">
              <input className={inputCls} type="date" required value={profile.birth_date} onChange={set('birth_date')} />
            </Field>
            <Field label="Telefon (opcjonalnie)">
              <input className={inputCls} value={profile.phone_number} onChange={set('phone_number')} placeholder="601 234 567" />
            </Field>
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
            <Button size="lg" className="w-full" disabled={busy} type="submit">
              {busy ? 'Zapisywanie…' : 'Utwórz profil pacjenta'}
            </Button>
          </form>
        )}
      </Tile>
    </div>
  )
}
