// Rejestracja pacjenta (UC-P1) — wizard: konto → dane → kontakt i zgody → podsumowanie.
// Konto w Supabase powstaje po kroku 1 (jak dotąd), profil pacjenta po podsumowaniu.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, HeartPulse, Pencil } from 'lucide-react'
import { Button, Field, Tile, cx, inputCls } from '../ui'
import { DEV_MODE, useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { peselValid } from '../lib/pesel'
import { DatePicker } from '../components/DatePicker'

const STEPS = ['Konto', 'Twoje dane', 'Kontakt i zgody', 'Podsumowanie']

// data urodzenia zakodowana w PESEL (miesiąc +20 = lata 2000+)
function birthFromPesel(pesel: string): string | null {
  if (!peselValid(pesel)) return null
  const yy = Number(pesel.slice(0, 2))
  const mmRaw = Number(pesel.slice(2, 4))
  const dd = pesel.slice(4, 6)
  const [year, mm] = mmRaw > 20 ? [2000 + yy, mmRaw - 20] : [1900 + yy, mmRaw]
  return `${year}-${String(mm).padStart(2, '0')}-${dd}`
}

export function Rejestracja() {
  const { token, profileMissing, registerAccount, refreshMe } = useAuth()
  const navigate = useNavigate()
  // konto już jest, brakuje profilu (UC-P1 dokończenie) → od kroku 2
  const accountReady = !!(token && profileMissing)
  const [step, setStep] = useState(accountReady ? 2 : 1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [profile, setProfile] = useState({
    first_name: '', last_name: '', pesel: '', birth_date: '', phone_number: '',
  })
  const [consentRodo, setConsentRodo] = useState(false)
  const [consentTerms, setConsentTerms] = useState(false)

  const set = (key: keyof typeof profile) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setProfile(p => {
      const next = { ...p, [key]: value }
      // PESEL niesie datę urodzenia — uzupełnij ją automatycznie (edytowalna)
      if (key === 'pesel') {
        const derived = birthFromPesel(value)
        if (derived) next.birth_date = derived
      }
      return next
    })
  }

  const peselBad = profile.pesel.length === 11 && !peselValid(profile.pesel)
  const passMismatch = !DEV_MODE && password2.length > 0 && password !== password2

  const submitAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (passMismatch) { setError('Hasła nie są identyczne.'); return }
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

  const submitProfile = async () => {
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

  const SummaryRow = ({ label, value, goto }: { label: string; value: string; goto: number }) => (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold tracking-wider text-gray-400 uppercase">{label}</p>
        <p className="truncate text-sm font-bold text-gray-900">{value || '—'}</p>
      </div>
      {(goto > 1 || !accountReady) && (
        <button onClick={() => setStep(goto)} aria-label={`Zmień: ${label}`}
          className="cursor-pointer rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary">
          <Pencil size={13} />
        </button>
      )}
    </div>
  )

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="fade-up mb-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white">
          <HeartPulse size={28} />
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900">Rejestracja</h1>
        <ol className="mt-3 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={cx(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold',
                step > i + 1 ? 'bg-primary text-white' : step === i + 1 ? 'bg-primary-soft text-primary' : 'bg-gray-100 text-gray-400',
              )}>
                {step > i + 1 ? <Check size={13} /> : i + 1}
              </span>
              <span className={cx('hidden text-xs font-bold sm:inline', step === i + 1 ? 'text-gray-900' : 'text-gray-400')}>{s}</span>
            </li>
          ))}
        </ol>
      </div>

      <Tile className="w-full max-w-sm p-6" delay={80}>
        {step === 1 && (
          <form className="space-y-4" onSubmit={submitAccount}>
            <p className="text-sm leading-relaxed font-medium text-gray-500">
              Załóż konto, którym będziesz się logować. W kolejnych krokach uzupełnisz
              dane potrzebne do wizyt i e-recept.
            </p>
            <Field label="Adres e-mail">
              <input className={inputCls} type="email" required value={email} onChange={e => setEmail(e.target.value)} />
            </Field>
            <Field label="Hasło" hint={DEV_MODE ? 'Tryb deweloperski — hasło nie jest zapisywane.' : 'Minimum 8 znaków.'}>
              <input className={inputCls} type="password" minLength={DEV_MODE ? undefined : 8} required={!DEV_MODE}
                value={password} onChange={e => setPassword(e.target.value)} />
            </Field>
            {!DEV_MODE && (
              <Field label="Powtórz hasło">
                <input className={inputCls} type="password" required value={password2} onChange={e => setPassword2(e.target.value)} />
                {passMismatch && <p className="mt-1 text-xs font-bold text-red-600">Hasła nie są identyczne.</p>}
              </Field>
            )}
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
            <Button size="lg" className="w-full" disabled={busy || passMismatch} type="submit">
              {busy ? 'Tworzenie konta…' : 'Dalej'}
            </Button>
            <p className="text-center text-sm font-medium text-gray-500">
              Masz już konto? <Link to="/login" className="font-extrabold text-primary hover:underline">Zaloguj się</Link>
            </p>
          </form>
        )}

        {step === 2 && (
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!peselBad) setStep(3) }}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Imię"><input className={inputCls} required value={profile.first_name} onChange={set('first_name')} /></Field>
              <Field label="Nazwisko"><input className={inputCls} required value={profile.last_name} onChange={set('last_name')} /></Field>
            </div>
            <Field label="PESEL" hint="potrzebny do e-recept i weryfikacji eWUŚ — datę urodzenia uzupełnimy z niego automatycznie">
              <input className={inputCls} required pattern="\d{11}" value={profile.pesel} onChange={set('pesel')} />
              {peselBad && <p className="mt-1 text-xs font-bold text-red-600">Nieprawidłowy PESEL (suma kontrolna).</p>}
            </Field>
            <Field label="Data urodzenia">
              <DatePicker required value={profile.birth_date} max={new Date().toISOString().slice(0, 10)}
                onChange={v => setProfile(p => ({ ...p, birth_date: v }))} />
            </Field>
            <Button size="lg" className="w-full" disabled={peselBad} type="submit">Dalej</Button>
          </form>
        )}

        {step === 3 && (
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); setStep(4) }}>
            <Field label="Telefon (opcjonalnie)" hint="na ten numer wyślemy SMS-y z przypomnieniami o wizytach">
              <input className={inputCls} value={profile.phone_number} onChange={set('phone_number')} placeholder="601 234 567" />
            </Field>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-gray-50 px-4 py-3">
              <input type="checkbox" required className="mt-0.5 h-4 w-4 accent-(--color-primary)"
                checked={consentRodo} onChange={e => setConsentRodo(e.target.checked)} />
              <span className="text-sm font-semibold text-gray-700">
                Wyrażam zgodę na przetwarzanie moich danych osobowych i medycznych w celu
                realizacji świadczeń zdrowotnych (RODO). <span className="text-red-600">*</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-gray-50 px-4 py-3">
              <input type="checkbox" required className="mt-0.5 h-4 w-4 accent-(--color-primary)"
                checked={consentTerms} onChange={e => setConsentTerms(e.target.checked)} />
              <span className="text-sm font-semibold text-gray-700">
                Akceptuję regulamin portalu NovaMed. <span className="text-red-600">*</span>
              </span>
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" type="button" onClick={() => setStep(2)}>Wstecz</Button>
              <Button size="lg" className="flex-1" disabled={!consentRodo || !consentTerms} type="submit">Dalej</Button>
            </div>
          </form>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed font-medium text-gray-500">
              Sprawdź dane przed utworzeniem profilu pacjenta:
            </p>
            {!accountReady && <SummaryRow label="E-mail" value={email} goto={1} />}
            <SummaryRow label="Imię i nazwisko" value={`${profile.first_name} ${profile.last_name}`} goto={2} />
            <SummaryRow label="PESEL" value={profile.pesel} goto={2} />
            <SummaryRow label="Data urodzenia" value={profile.birth_date} goto={2} />
            <SummaryRow label="Telefon" value={profile.phone_number} goto={3} />
            {error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-700">{error}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" type="button" onClick={() => setStep(3)}>Wstecz</Button>
              <Button size="lg" className="flex-1" disabled={busy} onClick={() => void submitProfile()}>
                {busy ? 'Zapisywanie…' : 'Utwórz profil pacjenta'}
              </Button>
            </div>
          </div>
        )}
      </Tile>
    </div>
  )
}
